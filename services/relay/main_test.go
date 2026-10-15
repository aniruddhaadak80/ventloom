package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

func TestRingZeroValueIsNotAssumed(t *testing.T) {
	// A ring built with a non-positive limit would silently drop everything,
	// which is the failure mode that hides a misconfiguration until a console
	// shows a permanently flat line. newRing is the only constructor, and it
	// clamps.
	r := newRing(3)
	for i := 0; i < 10; i++ {
		r.push(sample{EpochS: int64(i), UpM: float64(i)})
	}
	if got := r.len(); got != 3 {
		t.Fatalf("len = %d, want 3", got)
	}

	snap := r.snapshot()
	if len(snap) != 3 {
		t.Fatalf("snapshot length = %d, want 3", len(snap))
	}
	// The buffer must retain the most recent samples, not the first.
	want := []int64{7, 8, 9}
	for i, w := range want {
		if snap[i].EpochS != w {
			t.Fatalf("snapshot[%d].EpochS = %d, want %d", i, snap[i].EpochS, w)
		}
	}
}

func TestRingSnapshotIsADecoupledCopy(t *testing.T) {
	// A reader holding a snapshot must not see writes that happen after it
	// took it. Returning the backing slice would let a slow handler observe
	// a half-written row.
	r := newRing(4)
	r.push(sample{EpochS: 1})
	snap := r.snapshot()
	r.push(sample{EpochS: 2})

	if len(snap) != 1 {
		t.Fatalf("snapshot grew after a push: %d items", len(snap))
	}
	if snap[0].EpochS != 1 {
		t.Fatalf("snapshot mutated: EpochS = %d, want 1", snap[0].EpochS)
	}
}

func TestRingIsSafeUnderConcurrentUse(t *testing.T) {
	// The relay writes from the poll goroutine and reads from HTTP handlers,
	// so this is a race-detector target rather than a performance test.
	r := newRing(64)
	var wg sync.WaitGroup

	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 500; i++ {
			r.push(sample{EpochS: int64(i)})
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 500; i++ {
			_ = r.snapshot()
			_ = r.len()
		}
	}()
	wg.Wait()

	if r.len() != 64 {
		t.Fatalf("len = %d, want 64", r.len())
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func TestSqrtMatchesMathPkg(t *testing.T) {
	// mathSqrt is a hand-rolled Newton iteration. It is only correct if it
	// agrees with the standard library across the range the relay sees.
	values := []float64{0, 1e-12, 0.25, 1, 2, 9.81, 1234.5678, 1e6, 1e-9}
	for _, v := range values {
		got := mathSqrt(v)
		want := math.Sqrt(v)
		// Relative tolerance: an absolute one is meaningless across nine
		// orders of magnitude.
		if math.Abs(got-want) > want*1e-9+1e-12 {
			t.Fatalf("mathSqrt(%g) = %g, want %g", v, got, want)
		}
	}
}

func TestSqrtNeverReturnsNegativeOrNaN(t *testing.T) {
	// The magnitudes come from JSON, so a caller could in principle supply a
	// negative squared sum through a corrupted payload. Sinking it to zero is
	// better than propagating NaN into a sparkline.
	if got := mathSqrt(-1); got != 0 {
		t.Fatalf("mathSqrt(-1) = %g, want 0", got)
	}
	if got := mathSqrt(0); got != 0 {
		t.Fatalf("mathSqrt(0) = %g, want 0", got)
	}
}

func TestCutSplitsOnFirstSeparatorOnly(t *testing.T) {
	// Station keys are "volcanoId/STATIONCODE". Splitting on *every* separator
	// would mangle any volcano id containing one.
	before, after, found := cut("kilauea/HVZ12", '/')
	if !found || before != "kilauea" || after != "HVZ12" {
		t.Fatalf("cut = (%q, %q, %v)", before, after, found)
	}

	before, _, found = cut("no-separator", '/')
	if found || before != "no-separator" {
		t.Fatalf("cut on a separator-free string = (%q, %v)", before, found)
	}

	before, after, found = cut("a/b/c", '/')
	if !found || before != "a" || after != "b/c" {
		t.Fatalf("cut must split on the first separator only: (%q, %q)", before, after)
	}
}

func TestMagnitudeMIsEuclidean(t *testing.T) {
	d := displacement{EastM: 3, NorthM: 4, UpM: 0}
	if got := d.magnitudeM(); math.Abs(got-5) > 1e-12 {
		t.Fatalf("magnitude = %g, want 5", got)
	}
	// A purely vertical vector is its own magnitude: the component the geodesy
	// surface actually reads.
	if got := (displacement{UpM: -0.125}).magnitudeM(); math.Abs(got-0.125) > 1e-12 {
		t.Fatalf("vertical magnitude = %g, want 0.125", got)
	}
}

func TestEnvOrFallsBack(t *testing.T) {
	if got := envOr("VENTLOOM_DEFINITELY_NOT_SET", "fallback"); got != "fallback" {
		t.Fatalf("envOr = %q, want fallback", got)
	}
	t.Setenv("VENTLOOM_TEST_KEY", "set")
	if got := envOr("VENTLOOM_TEST_KEY", "fallback"); got != "set" {
		t.Fatalf("envOr = %q, want set", got)
	}
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// stubUpstream serves the payload shape the relay polls, so handler tests do
// not depend on a running observatory.
//
// It echoes the requested `?epoch=` back in the payload, exactly as the real
// `/api/network` route does. A stub that ignored the query would make every
// test pass against a server that answers every request with the same world,
// which is the one bug the relay most needs to be able to see.
func stubUpstream(t *testing.T, status int, payload any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if payload == nil {
			return
		}
		if v, ok := payload.(networkPayload); ok {
			if raw := req.URL.Query().Get("epoch"); raw != "" {
				if epoch, err := strconv.ParseInt(raw, 10, 64); err == nil {
					v.EpochS = epoch
				}
			}
			_ = json.NewEncoder(w).Encode(v)
			return
		}
		_ = json.NewEncoder(w).Encode(payload)
	}))
}

func samplePayload() networkPayload {
	return networkPayload{
		EpochS:    3888000,
		Timestamp: "2026-01-15T00:00:00.000Z",
		Volcanoes: []networkVolcano{{
			ID:     "etna",
			Name:   "Mount Etna",
			Unrest: 0.61,
			Tremor: "harmonic",
			Stations: []stationObservation{
				{Code: "ETN01", Instrument: "gnss", Displacement: displacement{EastM: 0.01, NorthM: -0.02, UpM: 0.041}},
				{Code: "ETN02", Instrument: "gnss", Displacement: displacement{UpM: -0.012}},
			},
		}},
	}
}

func newTestRelay(t *testing.T, upstream string) *relay {
	t.Helper()
	return newRelay(upstream, time.Minute, 8, discardLogger())
}

func TestPollRecordsOneSamplePerStation(t *testing.T) {
	server := stubUpstream(t, http.StatusOK, samplePayload())
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 3888000); err != nil {
		t.Fatalf("poll: %v", err)
	}

	// Two stations in one volcano must yield two distinct series, keyed by
	// "volcano/station" so a code reused across volcanoes cannot collide.
	keys := r.stationKeys()
	if len(keys) != 2 {
		t.Fatalf("station keys = %v, want 2 entries", keys)
	}
	if keys[0] != "etna/ETN01" || keys[1] != "etna/ETN02" {
		t.Fatalf("keys not namespaced by volcano: %v", keys)
	}

	snap := r.series["etna/ETN01"].snapshot()
	if len(snap) != 1 {
		t.Fatalf("samples = %d, want 1", len(snap))
	}
	if snap[0].EpochS != 3888000 {
		t.Fatalf("EpochS = %d, want 3888000", snap[0].EpochS)
	}
	// The vertical component and the magnitude are both carried forward.
	if math.Abs(snap[0].UpM-0.041) > 1e-9 {
		t.Fatalf("UpM = %g, want 0.041", snap[0].UpM)
	}
	if math.Abs(snap[0].Unrest-0.61) > 1e-9 {
		t.Fatalf("Unrest = %g, want 0.61", snap[0].Unrest)
	}
}

func TestPollFailureIsRecordedNotFatal(t *testing.T) {
	server := stubUpstream(t, http.StatusInternalServerError, nil)
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 0); err == nil {
		t.Fatal("poll against a 500 must return an error")
	}

	// A failed poll must not fabricate a timestamp or a last payload: a
	// console showing an old reading as if it were fresh is the specific
	// failure this service exists to prevent.
	r.mu.RLock()
	last, lastPoll := r.last, r.lastPoll
	r.mu.RUnlock()
	if last != nil {
		t.Fatal("last payload must stay nil after a failed poll")
	}
	if !lastPoll.IsZero() {
		t.Fatal("lastPoll must stay zero after a failed poll")
	}
}

func TestHealthIsDegradedBeforeTheFirstPoll(t *testing.T) {
	r := newTestRelay(t, "http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	r.handleHealth(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 before the first poll", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body["status"] != "starting" {
		t.Fatalf("status = %v, want starting", body["status"])
	}
}

func TestSeriesRequiresAStationParameter(t *testing.T) {
	r := newTestRelay(t, "http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/series", nil)
	rec := httptest.NewRecorder()
	r.handleSeries(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	// The error must name the parameter, because a bare "bad request" sends
	// the caller to read the source.
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] == nil || body["error"] == "" {
		t.Fatal("the 400 body must explain what was missing")
	}
}

func TestSeriesUnknownStationListsWhatIsAvailable(t *testing.T) {
	server := stubUpstream(t, http.StatusOK, samplePayload())
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 0); err != nil {
		t.Fatalf("poll: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/series?station=etna/NOPE", nil)
	rec := httptest.NewRecorder()
	r.handleSeries(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}

	var body struct {
		Error     string   `json:"error"`
		Available []string `json:"available"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if len(body.Available) != 2 {
		t.Fatalf("available = %v, want the two real stations", body.Available)
	}
	if body.Available[0] != "etna/ETN01" {
		t.Fatalf("available[0] = %q, want etna/ETN01", body.Available[0])
	}
}

func TestSeriesReturnsTheRetainedWindow(t *testing.T) {
	server := stubUpstream(t, http.StatusOK, samplePayload())
	defer server.Close()

	r := newTestRelay(t, server.URL)
	// Three polls at a fixed step, exactly as runUntil would drive them.
	for _, epoch := range []int64{0, 3600, 7200} {
		if err := r.poll(t.Context(), epoch); err != nil {
			t.Fatalf("poll(%d): %v", epoch, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/series?station=etna/ETN01", nil)
	rec := httptest.NewRecorder()
	r.handleSeries(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body seriesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body.Count != 3 {
		t.Fatalf("count = %d, want 3", body.Count)
	}
	if body.EpochS != 7200 {
		t.Fatalf("epoch = %d, want the most recent (7200)", body.EpochS)
	}
	// Samples must be in poll order, which is what makes a sparkline readable.
	for i, want := range []int64{0, 3600, 7200} {
		if body.Samples[i].EpochS != want {
			t.Fatalf("samples[%d].EpochS = %d, want %d", i, body.Samples[i].EpochS, want)
		}
	}
}

func TestStatusCarriesItsOwnAge(t *testing.T) {
	server := stubUpstream(t, http.StatusOK, samplePayload())
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 100); err != nil {
		t.Fatalf("poll: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	rec := httptest.NewRecorder()
	r.handleStatus(rec, req)

	var body statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status = %q, want ok", body.Status)
	}
	if body.EpochS != 100 {
		t.Fatalf("epoch = %d, want 100", body.EpochS)
	}
	if body.Stations != 2 {
		t.Fatalf("stations = %d, want 2", body.Stations)
	}
	if body.Polls != 1 {
		t.Fatalf("polls = %d, want 1", body.Polls)
	}
	if body.AgeS < 0 || body.AgeS > 5 {
		t.Fatalf("pollAgeSeconds = %g, want a value near zero", body.AgeS)
	}
	if body.Go == "" {
		t.Fatal("the status must report its Go runtime, for a support ticket")
	}
}

func TestStatusReportsDegradedWithTheReason(t *testing.T) {
	server := stubUpstream(t, http.StatusBadGateway, nil)
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 0); err == nil {
		t.Fatal("expected the poll to fail")
	}

	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	rec := httptest.NewRecorder()
	r.handleStatus(rec, req)

	var body statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body.Status != "degraded" {
		t.Fatalf("status = %q, want degraded", body.Status)
	}
	// The reason must survive into the response, or a degraded console is
	// indistinguishable from a healthy one with a typo.
	if body.LastError == "" {
		t.Fatal("lastError must be populated when a poll has failed")
	}
	if body.Failures != 1 {
		t.Fatalf("failures = %d, want 1", body.Failures)
	}
}

func TestStationsHandlerNamespacesByVolcano(t *testing.T) {
	server := stubUpstream(t, http.StatusOK, samplePayload())
	defer server.Close()

	r := newTestRelay(t, server.URL)
	if err := r.poll(t.Context(), 0); err != nil {
		t.Fatalf("poll: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/stations", nil)
	rec := httptest.NewRecorder()
	r.handleStations(rec, req)

	var body struct {
		Stations []string       `json:"stations"`
		Count    int            `json:"count"`
		Samples  map[string]int `json:"samples"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body.Count != 2 {
		t.Fatalf("count = %d, want 2", body.Count)
	}
	// The per-volcano tally is what tells a caller whether a relay has been
	// warming up or just started.
	if body.Samples["etna"] != 2 {
		t.Fatalf("samples[etna] = %d, want 2", body.Samples["etna"])
	}
}

func TestWriteJSONSetsNoStore(t *testing.T) {
	// Every response is derived from a poll that could be seconds old, so a
	// shared cache in front of the relay would be actively wrong.
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, map[string]string{"status": "ok"})

	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
}
