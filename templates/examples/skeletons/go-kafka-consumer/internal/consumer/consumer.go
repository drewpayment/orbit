// Package consumer wraps franz-go into a small, testable consume loop for
// {{ .SERVICE_NAME }}.
package consumer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/twmb/franz-go/pkg/kgo"
)

// Config configures the Kafka client.
type Config struct {
	// Brokers is a comma-separated list of seed broker addresses.
	Brokers string
	Topic   string
	Group   string
}

func (c Config) seedBrokers() []string {
	brokers := strings.Split(c.Brokers, ",")
	out := make([]string, 0, len(brokers))
	for _, b := range brokers {
		b = strings.TrimSpace(b)
		if b != "" {
			out = append(out, b)
		}
	}
	return out
}

func (c Config) validate() error {
	if len(c.seedBrokers()) == 0 {
		return errors.New("consumer: at least one broker is required")
	}
	if c.Topic == "" {
		return errors.New("consumer: topic is required")
	}
	if c.Group == "" {
		return errors.New("consumer: consumer group is required")
	}
	return nil
}

// RecordHandler processes one consumed record. Returning an error does not
// stop the consume loop; it is logged and the record is still marked
// consumed (at-least-once semantics via the client's auto-commit).
type RecordHandler func(*kgo.Record) error

// Consumer owns a franz-go client and a topic/group subscription.
type Consumer struct {
	client *kgo.Client
	topic  string
}

// New builds a Consumer from cfg. The returned Consumer's underlying client
// is not connected until Run is called.
func New(cfg Config) (*Consumer, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}

	client, err := kgo.NewClient(
		kgo.SeedBrokers(cfg.seedBrokers()...),
		kgo.ConsumeTopics(cfg.Topic),
		kgo.ConsumerGroup(cfg.Group),
		kgo.AutoCommitMarks(),
	)
	if err != nil {
		return nil, fmt.Errorf("consumer: new client: %w", err)
	}

	return &Consumer{client: client, topic: cfg.Topic}, nil
}

// Run polls for records until ctx is cancelled, invoking handle for each
// one. It returns nil on a clean shutdown (ctx cancellation).
func (c *Consumer) Run(ctx context.Context, handle RecordHandler) error {
	for {
		fetches := c.client.PollFetches(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if errs := fetches.Errors(); len(errs) > 0 {
			for _, e := range errs {
				log.Printf("fetch error: topic=%s partition=%d err=%v", e.Topic, e.Partition, e.Err)
			}
		}

		fetches.EachRecord(func(r *kgo.Record) {
			if err := handle(r); err != nil {
				log.Printf("handle record: partition=%d offset=%d err=%v", r.Partition, r.Offset, err)
			}
			c.client.MarkCommitRecords(r)
		})
	}
}

// Close releases the underlying client's connections.
func (c *Consumer) Close() {
	c.client.Close()
}

// LogRecord is the default RecordHandler: it logs the record's key/value and
// does nothing else. Replace this with real processing logic.
func LogRecord(r *kgo.Record) error {
	log.Printf("record: topic=%s partition=%d offset=%d key=%q value=%q",
		r.Topic, r.Partition, r.Offset, string(r.Key), string(r.Value))
	return nil
}
