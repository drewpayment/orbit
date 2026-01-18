import type { CodeSnippetParams } from './index'

export function generateGoSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '')

  return `// Go - segmentio/kafka-go
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/scram"
)

func main() {
	mechanism, _ := scram.Mechanism(scram.SHA256, "${params.username}", os.Getenv("KAFKA_PASSWORD"))

	dialer := &kafka.Dialer{
		SASLMechanism: mechanism,
		TLS:           ${params.tlsEnabled ? '&tls.Config{}' : 'nil'},
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{"${params.bootstrapServers}"},
		Topic:   "${params.topicName}",
		GroupID: "my-consumer-group",
		Dialer:  dialer,
	})
	defer reader.Close()

	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			fmt.Printf("Error: %v\\n", err)
			break
		}
		fmt.Printf("Message at offset %d: %s\\n", msg.Offset, string(msg.Value))
	}
}`
}
