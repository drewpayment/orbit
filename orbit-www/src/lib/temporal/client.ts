import { Client, Connection } from '@temporalio/client';

let temporalClient: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    temporalClient = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });
  }
  
  return temporalClient;
}

export async function closeTemporalClient(): Promise<void> {
  if (temporalClient) {
    await temporalClient.connection.close();
    temporalClient = null;
  }
}