import type { CodeSnippetParams } from './index'

export function generateNodejsSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').toLowerCase().replace('-', '-')

  return `// Node.js - KafkaJS
const { Kafka } = require('kafkajs')

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['${params.bootstrapServers}'],
  ssl: ${params.tlsEnabled},
  sasl: {
    mechanism: '${mechanism}',
    username: '${params.username}',
    password: process.env.KAFKA_PASSWORD,
  },
})

const consumer = kafka.consumer({ groupId: 'my-consumer-group' })

async function run() {
  await consumer.connect()
  await consumer.subscribe({ topic: '${params.topicName}', fromBeginning: true })

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log({
        topic,
        partition,
        offset: message.offset,
        value: message.value.toString(),
      })
    },
  })
}

run().catch(console.error)`
}
