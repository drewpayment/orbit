import type { CodeSnippetParams } from './index'

export function generateJavaSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '')

  return `// Java - Apache Kafka Client
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import java.time.Duration;
import java.util.*;

Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "${params.bootstrapServers}");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "my-consumer-group");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

// Authentication
props.put("security.protocol", "${params.tlsEnabled ? 'SASL_SSL' : 'SASL_PLAINTEXT'}");
props.put("sasl.mechanism", "${mechanism}");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\\"${params.username}\\" " +
    "password=\\"" + System.getenv("KAFKA_PASSWORD") + "\\";");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("${params.topicName}"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        System.out.printf("offset=%d, key=%s, value=%s%n",
            record.offset(), record.key(), record.value());
    }
}`
}
