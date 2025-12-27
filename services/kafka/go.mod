module github.com/drewpayment/orbit/services/kafka

go 1.24.7

replace github.com/drewpayment/orbit/proto => ../../proto

require github.com/google/uuid v1.6.0

require (
	github.com/drewpayment/orbit/proto v0.0.0-20251227152417-f7ff7038c7ec // indirect
	golang.org/x/net v0.47.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
	golang.org/x/text v0.31.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251029180050-ab9386a59fda // indirect
	google.golang.org/grpc v1.78.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
