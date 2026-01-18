import type { CodeSnippetParams } from './index'

export function generatePythonSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '_')

  return `# Python - confluent-kafka
import os
from confluent_kafka import Consumer

config = {
    'bootstrap.servers': '${params.bootstrapServers}',
    'group.id': 'my-consumer-group',
    'auto.offset.reset': 'earliest',
    # Authentication
    'security.protocol': '${params.tlsEnabled ? 'SASL_SSL' : 'SASL_PLAINTEXT'}',
    'sasl.mechanism': '${mechanism}',
    'sasl.username': '${params.username}',
    'sasl.password': os.environ.get('KAFKA_PASSWORD'),
}

consumer = Consumer(config)
consumer.subscribe(['${params.topicName}'])

try:
    while True:
        msg = consumer.poll(timeout=1.0)
        if msg is None:
            continue
        if msg.error():
            print(f"Consumer error: {msg.error()}")
            continue
        print(f"Received: {msg.value().decode('utf-8')}")
finally:
    consumer.close()`
}
