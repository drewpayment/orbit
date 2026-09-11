# {{ .SERVICE_NAME }}

{{ .DESCRIPTION }}

Owner: {{ .OWNER }}

Consumes the `{{ .TOPIC_NAME }}` Kafka topic using [franz-go](https://github.com/twmb/franz-go)
and logs each record. Replace `consumer.LogRecord` in `main.go` with real
processing logic.

## Configure

Environment variables (see `config.example.yaml` for the equivalent shape):

| Variable                | Default            |
| ------------------------ | ------------------ |
| `KAFKA_BROKERS`          | `localhost:9092`   |
| `KAFKA_TOPIC`            | `{{ .TOPIC_NAME }}` |
| `KAFKA_CONSUMER_GROUP`   | `{{ .SERVICE_NAME }}` |

## Run locally

```sh
go run .
```

## Test

```sh
make test
```
