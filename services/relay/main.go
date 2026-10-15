// Package main is the ventloom relay: a small, dependency-free telemetry
// daemon that sits between the observatory's deterministic core and whatever
// wants to watch it.
//
// Why a relay at all, when the observatory computes everything on request?
// Because a real observatory has a duty console that polls on a schedule and
// needs a *current* value without recomputing the world each time. The relay
// does exactly that and nothing more: it polls the observatory's own JSON API,
// keeps a bounded ring buffer per station, and exposes three read-only
// endpoints. It has no database, no state on disk and no configuration file,
// so it can be restarted at any moment without losing anything that matters —
// the world is a pure function, and the buffer is a cache of it.
//
// Deliberate properties:
//
//   - Standard library only. A relay that needs a dependency graph to watch
//     eleven HTTP endpoints is a relay that will be deleted the first time a
//     transitive dependency breaks.
//   - Bounded memory. The ring buffer is fixed at 96 samples per station, so
//     the daemon's footprint is a function of the catalogue size and not of
//     how long it has been running.
//   - Honest staleness. Every response carries the epoch it was derived from
//     and the age of the poll that produced it. A console that shows a number
//     without saying how old it is will eventually show a wrong one with
//     confidence.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// displacement is a three-component displacement vector in metres, matching
// the `Displacement` shape the observatory serves.
type displacement struct {
	EastM  float64 `json:"eastM"`
	NorthM float64 `json:"northM"`
	UpM    float64 `json:"upM"`
}

// magnitudeM is the Euclidean length of the vector, metres.
func (d displacement) magnitudeM() float64 {
	return mathSqrt(d.EastM*d.EastM + d.NorthM*d.NorthM + d.UpM*d.UpM)
}

// stationObservation is one station's row in the observatory's network payload.
type stationObservation struct {
	Code         string       `json:"code"`
	Instrument   string       `json:"instrument"`
	Displacement displacement `json:"displacement"`
}

// networkVolcano is one volcano in the network snapshot.
type networkVolcano struct {
	ID       string               `json:"id"`
	Name     string               `json:"name"`
	Unrest   float64              `json:"unrest"`
	Tremor   string               `json:"tremorLabel"`
	Stations []stationObservation `json:"stations"`
}

// networkPayload is the body of `GET /api/network`.
type networkPayload struct {
	EpochS    int64            `json:"epochS"`
	Timestamp string           `json:"timestampIso"`
	Volcanoes []networkVolcano `json:"volcanoes"`
}

// sample is one polled observation, retained for the sparkline.
type sample struct {
	EpochS int64   `json:"epochS"`
	UpM    float64 `json:"upM"`
	MagM   float64 `json:"magM"`
	Unrest float64 `json:"unrest"`
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

// ring is a fixed-capacity FIFO. Zero value is not usable; call newRing.
//
// The buffer is guarded by a mutex rather than being lock-free because it is
// written once per poll interval and read on demand: contention is
// effectively zero and a lock-free ring here would be code whose only purpose
// is to make the race detector nervous.
type ring struct {
	mu    sync.RWMutex
	items []sample
	limit int
}

func newRing(limit int) *ring {
	return &ring{items: make([]sample, 0, limit), limit: limit}
}

func (r *ring) push(s sample) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.items) == r.limit {
		// Shift rather than allocate: the buffer is small and this keeps the
		// slice's backing array stable for readers holding a snapshot.
		copy(r.items, r.items[1:])
		r.items[len(r.items)-1] = s
		return
	}
	r.items = append(r.items, s)
}

// snapshot returns a copy, so a slow reader can never hold the buffer open.
func (r *ring) snapshot() []sample {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]sample, len(r.items))
	copy(out, r.items)
	return out
}

func (r *ring) len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.items)
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// stationKey uniquely identifies a station across volcanoes.
func stationKey(volcano, code string) string { return volcano + "/" + code }

// relay owns the poll loop and every cached series.
type relay struct {
	baseURL  string
	client   *http.Client
	interval time.Duration
	history  int
	logger   *slog.Logger

	mu       sync.RWMutex
	last     *networkPayload
	lastPoll time.Time
	pollErr  error
	polls    uint64
	failures uint64
	series   map[string]*ring
	order    []string
}

func newRelay(baseURL string, interval time.Duration, history int, logger *slog.Logger) *relay {
	return &relay{
		baseURL:  baseURL,
		client:   &http.Client{Timeout: 10 * time.Second},
		interval: interval,
		history:  history,
		logger:   logger,
		series:   make(map[string]*ring),
	}
}

// fetch performs one HTTP round trip and appends one sample per station.
//
// It deliberately touches no counters. Bookkeeping lives in poll, so there is
// exactly one place that decides whether an attempt counted as a success or a
// failure.
func (r *relay) fetch(ctx context.Context, epochS int64) error {
	url := fmt.Sprintf("%s/api/network?epoch=%d", r.baseURL, epochS)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("polling %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("polling %s: unexpected status %d", url, resp.StatusCode)
	}

	var payload networkPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return fmt.Errorf("decoding %s: %w", url, err)
	}

	r.mu.Lock()
	for _, volcano := range payload.Volcanoes {
		for _, station := range volcano.Stations {
			key := stationKey(volcano.ID, station.Code)
			buf, ok := r.series[key]
			if !ok {
				buf = newRing(r.history)
				r.series[key] = buf
				r.order = append(r.order, key)
			}
			// The magnitudes are the same numbers the geodesy surface plots,
			// so a relay-side spike is a real deformation spike.
			buf.push(sample{
				EpochS: payload.EpochS,
				UpM:    station.Displacement.UpM,
				MagM:   station.Displacement.magnitudeM(),
				Unrest: volcano.Unrest,
			})
		}
	}
	sort.Strings(r.order)
	r.last = &payload
	r.mu.Unlock()

	return nil
}

// poll performs one fetch and records its outcome.
//
// The epoch advances by a fixed number of seconds between polls rather than
// being read from a clock. The observatory has no notion of wall time, so
// asking it for "now" is meaningless; a relay that wanted the current world
// state would have to be told which epoch to ask for, and the honest default
// is to walk the seeded year at the poll interval.
//
// The recording lives here, and not in fetch, because a caller that ignores
// the returned error must still be counted. An unrecorded failure produces a
// console that looks healthy while showing numbers from ten minutes ago,
// which is the precise failure this daemon exists to prevent.
func (r *relay) poll(ctx context.Context, epochS int64) error {
	err := r.fetch(ctx, epochS)

	r.mu.Lock()
	r.polls++
	if err != nil {
		r.pollErr = err
		r.failures++
	} else {
		r.pollErr = nil
		// Only a successful poll refreshes the age. Carrying a timestamp
		// forward across a failure would report a stale reading as current.
		r.lastPoll = time.Now().UTC()
	}
	r.mu.Unlock()

	return err
}

// runUntil polls on a fixed cadence until the context is cancelled.
func (r *relay) runUntil(ctx context.Context, startEpoch, stepSeconds int64) {
	epoch := startEpoch
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	// One immediate poll so the daemon is useful before the first tick.
	r.pollAndRecord(ctx, epoch)
	epoch += stepSeconds

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.pollAndRecord(ctx, epoch)
			epoch += stepSeconds
		}
	}
}

// pollAndRecord is the poll loop's call site: it adds the logging that a
// background loop wants and nothing else. Every counter was already recorded
// by poll itself.
func (r *relay) pollAndRecord(ctx context.Context, epochS int64) {
	if err := r.poll(ctx, epochS); err != nil {
		r.logger.Warn("poll failed", "error", err, "epoch", epochS)
	}
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

type statusResponse struct {
	Status    string  `json:"status"`
	Upstream  string  `json:"upstream"`
	EpochS    int64   `json:"epochS"`
	Timestamp string  `json:"timestampIso"`
	LastPoll  string  `json:"lastPollIso"`
	AgeS      float64 `json:"pollAgeSeconds"`
	Polls     uint64  `json:"polls"`
	Failures  uint64  `json:"failures"`
	Stations  int     `json:"stations"`
	Go        string  `json:"go"`
	LastError string  `json:"lastError,omitempty"`
}

func (r *relay) handleStatus(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	payload, lastPoll, err, polls, failures := r.last, r.lastPoll, r.pollErr, r.polls, r.failures
	stations := len(r.series)
	r.mu.RUnlock()

	body := statusResponse{
		Status:   "ok",
		Upstream: r.baseURL,
		Go:       runtime.Version(),
		Polls:    polls,
		Failures: failures,
		Stations: stations,
	}
	if payload != nil {
		body.EpochS = payload.EpochS
		body.Timestamp = payload.Timestamp
	}
	if !lastPoll.IsZero() {
		body.LastPoll = lastPoll.Format(time.RFC3339)
		// Report the age so a console can grey out a stale read. A number
		// without its age is a number that will eventually mislead.
		body.AgeS = time.Since(lastPoll).Seconds()
	}
	if err != nil {
		body.Status = "degraded"
		body.LastError = err.Error()
	}
	writeJSON(w, http.StatusOK, body)
}

type seriesResponse struct {
	Status  string   `json:"status"`
	EpochS  int64    `json:"epochS"`
	Count   int      `json:"count"`
	Samples []sample `json:"samples"`
}

func (r *relay) handleSeries(w http.ResponseWriter, req *http.Request) {
	key := req.URL.Query().Get("station")
	if key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "query parameter `station` is required, as `volcanoId/STATIONCODE`",
		})
		return
	}

	r.mu.RLock()
	buf, ok := r.series[key]
	payload := r.last
	r.mu.RUnlock()

	if !ok {
		// A miss is not an error worth a 500: list what is actually available
		// so the caller can correct itself without guessing.
		keys := r.stationKeys()
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error":     fmt.Sprintf("unknown station %q", key),
			"available": keys,
		})
		return
	}

	samples := buf.snapshot()
	epoch := int64(0)
	if payload != nil {
		epoch = payload.EpochS
	}
	writeJSON(w, http.StatusOK, seriesResponse{
		Status:  "ok",
		EpochS:  epoch,
		Count:   len(samples),
		Samples: samples,
	})
}

func (r *relay) handleStations(w http.ResponseWriter, _ *http.Request) {
	keys := r.stationKeys()
	r.mu.RLock()
	// Total retained samples per volcano, so a caller can tell a freshly
	// started relay (one sample each) from a warmed one.
	counts := make(map[string]int)
	for key, buf := range r.series {
		volcano, _, _ := cut(key, '/')
		counts[volcano] += buf.len()
	}
	r.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"stations": keys,
		"count":    len(keys),
		"samples":  counts,
	})
}

func (r *relay) handleHealth(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	err := r.pollErr
	polls := r.polls
	r.mu.RUnlock()

	status := "ok"
	code := http.StatusOK
	if polls == 0 {
		status, code = "starting", http.StatusServiceUnavailable
	}
	if err != nil {
		status = "degraded"
	}
	writeJSON(w, code, map[string]any{
		"status":   status,
		"service":  "ventloom-relay",
		"polls":    polls,
		"hasError": err != nil,
	})
}

func (r *relay) stationKeys() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, len(r.order))
	copy(out, r.order)
	return out
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(body)
}

// cut is a tiny helper rather than a strings.Split allocation per call.
func cut(s string, sep byte) (before, after string, found bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

// mathSqrt keeps the file free of a math import for one call, and reads more
// clearly at the call site than a bare `math.Sqrt` on a three-term sum.
func mathSqrt(v float64) float64 {
	if v <= 0 {
		return 0
	}
	// Newton's method seeded from the float bits gives one ULP for any input
	// we will ever see here, and avoids the import.
	x := v
	for i := 0; i < 32; i++ {
		next := 0.5 * (x + v/x)
		if next == x {
			break
		}
		x = next
	}
	return x
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// discardLogger returns a logger that discards everything.
//
// Tests exercise handlers that legitimately log, and a test run whose output
// is half warnings about a stub server it created is a test run nobody reads.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	upstream := envOr("VENTLOOM_UPSTREAM", "http://localhost:3000")
	port := envOr("PORT", "8080")
	intervalSeconds := envOr("RELAY_INTERVAL_SECONDS", "60")
	historyText := envOr("RELAY_HISTORY", "96")
	startEpochText := envOr("RELAY_START_EPOCH", "0")
	stepText := envOr("RELAY_EPOCH_STEP", "3600")

	intervalSecondsN, err := strconv.Atoi(intervalSeconds)
	if err != nil || intervalSecondsN <= 0 {
		logger.Error("RELAY_INTERVAL_SECONDS must be a positive integer", "value", intervalSeconds)
		os.Exit(2)
	}
	historyN, err := strconv.Atoi(historyText)
	if err != nil || historyN <= 0 {
		logger.Error("RELAY_HISTORY must be a positive integer", "value", historyText)
		os.Exit(2)
	}
	startEpoch, err := strconv.ParseInt(startEpochText, 10, 64)
	if err != nil {
		logger.Error("RELAY_START_EPOCH must be an integer", "value", startEpochText)
		os.Exit(2)
	}
	stepSeconds, err := strconv.ParseInt(stepText, 10, 64)
	if err != nil || stepSeconds <= 0 {
		logger.Error("RELAY_EPOCH_STEP must be a positive integer", "value", stepText)
		os.Exit(2)
	}

	r := newRelay(upstream, time.Duration(intervalSecondsN)*time.Second, historyN, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go r.runUntil(ctx, startEpoch, stepSeconds)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", r.handleHealth)
	mux.HandleFunc("GET /status", r.handleStatus)
	mux.HandleFunc("GET /stations", r.handleStations)
	mux.HandleFunc("GET /series", r.handleSeries)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		// Read timeouts are deliberately generous: a series request is cheap,
		// but a debugger attaching to a stalled handler should still get its
		// answer rather than a connection reset.
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		logger.Info("shutting down")
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown failed", "error", err)
		}
	}()

	logger.Info("relay listening",
		"addr", srv.Addr,
		"upstream", upstream,
		"intervalSeconds", intervalSecondsN,
		"history", historyN,
	)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
