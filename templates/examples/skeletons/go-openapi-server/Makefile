.PHONY: build test lint run

build:
	go build -o bin/{{ .SERVICE_NAME }} .

test:
	go test -v -race ./...

lint:
	gofmt -l .
	go vet ./...

run: build
	./bin/{{ .SERVICE_NAME }}
