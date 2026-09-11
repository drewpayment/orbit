FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/{{ .SERVICE_NAME }} .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/{{ .SERVICE_NAME }} /usr/local/bin/{{ .SERVICE_NAME }}
USER nonroot:nonroot
EXPOSE {{ .PORT }}
ENTRYPOINT ["/usr/local/bin/{{ .SERVICE_NAME }}"]
