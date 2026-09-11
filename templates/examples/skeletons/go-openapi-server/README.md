# {{ .SERVICE_NAME }}

{{ .DESCRIPTION }}

Owner: {{ .OWNER }}

Spec-first REST API: `api/openapi.yaml` is the contract registered with
Orbit's API catalog when this repository was scaffolded, embedded into the
binary and served at `GET /openapi.yaml`. `internal/handlers` implements the
`/widgets` example resource from the default spec; extend both together as
the API grows.

## Run locally

```sh
go run .
```

Listens on `PORT` (default `{{ .PORT }}`).

- `GET /healthz` — liveness/readiness.
- `GET /openapi.yaml` — the registered spec.
- `GET /widgets`, `POST /widgets`, `GET /widgets/{id}` — example resource.

## Test

```sh
make test
```
