import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NonRetryableSinkError,
  RetryableSinkError,
} from '../../src/outbox-relay/event-sink';
import type { RelayEvent } from '../../src/outbox-relay/relay-event';
import { HttpEventSink } from '../../src/outbox-relay/http-event-sink';

function makeEvent(id: string): RelayEvent {
  return {
    id,
    source: 'some-producer-api',
    eventType: 'subscription.created',
    resourceType: 'subscription',
    resourceId: '22222222-2222-4222-8222-222222222222',
    payload: { some: 'data' },
    occurredAt: '2026-08-20T10:00:00.000Z',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpEventSink', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const makeSink = () =>
    new HttpEventSink({ baseUrl: 'http://events-api', apiKey: 'secret' });

  it('posts the batch to /events with the api key and re-keys results to origin ids', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [
      // The events API's own ids differ from the outbox ids and are discarded.
      { id: 'destination-1', status: 'accepted' },
      { id: 'destination-2', status: 'duplicate' },
    ]));

    const results = await makeSink().deliverBatch([makeEvent('a'), makeEvent('b')]);

    expect(results).toEqual([
      { id: 'a', status: 'accepted' },
      { id: 'b', status: 'duplicate' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://events-api/events', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-api-key': 'secret' }),
    }));
  });

  it('honors a custom path, api key header and extra headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ status: 'accepted' }]));
    const sink = new HttpEventSink({
      baseUrl: 'http://gateway',
      apiKey: 'secret',
      eventsPath: '/v2/ingest',
      apiKeyHeader: 'authorization',
      extraHeaders: { 'x-tenant': 'telcel', 'content-type': 'text/plain' },
    });

    await sink.deliverOne(makeEvent('a'));

    expect(fetchMock).toHaveBeenCalledWith('http://gateway/v2/ingest', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'secret',
        'x-tenant': 'telcel',
        // Contract headers win over extraHeaders on clash.
        'content-type': 'application/json',
      }),
    }));
  });

  it('delivers a single event through the same endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ status: 'accepted' }]));

    const result = await makeSink().deliverOne(makeEvent('a'));

    expect(result).toEqual({ id: 'a', status: 'accepted' });
  });

  it('wraps a network failure as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(makeSink().deliverBatch([makeEvent('a')]))
      .rejects.toBeInstanceOf(RetryableSinkError);
  });

  it('maps 400 to a non-retryable contract error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'invalid resourceId' }));

    const failure = makeSink().deliverBatch([makeEvent('a')]);

    await expect(failure).rejects.toBeInstanceOf(NonRetryableSinkError);
    await expect(failure).rejects.toMatchObject({ kind: 'contract' });
  });

  it('maps 401 to a non-retryable configuration error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'bad key' }));

    const failure = makeSink().deliverBatch([makeEvent('a')]);

    await expect(failure).rejects.toBeInstanceOf(NonRetryableSinkError);
    await expect(failure).rejects.toMatchObject({ kind: 'configuration' });
  });

  it('treats a 5xx as retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));

    await expect(makeSink().deliverBatch([makeEvent('a')]))
      .rejects.toBeInstanceOf(RetryableSinkError);
  });

  it('treats a 200 with a non-JSON body as retryable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>proxy</html>', { status: 200 }));

    await expect(makeSink().deliverBatch([makeEvent('a')]))
      .rejects.toBeInstanceOf(RetryableSinkError);
  });

  it('treats a 200 with the wrong result count as retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ status: 'accepted' }]));

    await expect(makeSink().deliverBatch([makeEvent('a'), makeEvent('b')]))
      .rejects.toBeInstanceOf(RetryableSinkError);
  });

  it('treats a 200 with an unknown per-event status as retryable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ status: 'stored' }]));

    await expect(makeSink().deliverBatch([makeEvent('a')]))
      .rejects.toBeInstanceOf(RetryableSinkError);
  });
});
