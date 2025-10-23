module github.com/drewpayment/orbit/services/plugins

go 1.21

replace github.com/drewpayment/orbit/proto => ../../proto

require (
	github.com/drewpayment/orbit/proto v0.0.0-00010101000000-000000000000
	github.com/golang-jwt/jwt/v5 v5.2.0
	github.com/sony/gobreaker v0.5.0
	google.golang.org/grpc v1.65.0
)

require (
	golang.org/x/net v0.25.0 // indirect
	golang.org/x/sys v0.20.0 // indirect
	golang.org/x/text v0.15.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240528184218-531527333157 // indirect
	google.golang.org/protobuf v1.34.2 // indirect
)
