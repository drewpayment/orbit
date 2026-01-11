import type { CollectionConfig } from 'payload'

export const KafkaChargebackRates: CollectionConfig = {
  slug: 'kafka-chargeback-rates',
  admin: {
    useAsTitle: 'effectiveDate',
    group: 'Kafka',
    defaultColumns: ['effectiveDate', 'costPerGBIn', 'costPerGBOut', 'costPerMillionMessages'],
    description: 'System-wide chargeback rates for Kafka usage billing',
  },
  access: {
    // Only platform admins can manage rates
    read: ({ req: { user } }) => user?.collection === 'users',
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'costPerGBIn',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of ingress (produce) traffic. Example: 0.10 = $0.10/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerGBOut',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of egress (consume) traffic. Example: 0.05 = $0.05/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerMillionMessages',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per million messages. Example: 0.01 = $0.01/million',
        step: 0.001,
      },
    },
    {
      name: 'effectiveDate',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Date from which these rates apply. Most recent rate before billing period start is used.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Internal notes about this rate change',
      },
    },
  ],
  timestamps: true,
}
