# syntax=docker/dockerfile:1

FROM golang:1.24-alpine AS build
WORKDIR /src

COPY go.mod go.sum* ./
COPY . ./
RUN go mod download 2>/dev/null; true
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/relay ./

FROM scratch AS runtime
COPY --from=build /out/relay /relay
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["",]
ENTRYPOINT ["/relay"]
