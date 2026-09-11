# {{ .SERVICE_NAME }}

{{ .DESCRIPTION }}

Owner: {{ .OWNER }}

## Run locally

```sh
go run .
```

Listens on `PORT` (default `{{ .PORT }}`). Endpoints:

- `GET /healthz` — liveness/readiness JSON.
- `GET /` — plain-text service banner.

## Test

```sh
make test
```

## Build

```sh
make build
```

## Docker

```sh
docker build -t {{ .SERVICE_NAME }} .
docker run -p {{ .PORT }}:{{ .PORT }} {{ .SERVICE_NAME }}
```
