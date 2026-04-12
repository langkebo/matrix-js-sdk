import { Method, type Body, type IRequestOpts } from "./http-api/index.ts";
import type { EmptyObject } from "./@types/common.ts";
import type { SendToDeviceContentMap } from "./client-api-types.ts";
import { type QueryDict, encodeUri } from "./utils.ts";

export interface SendToDeviceOptions {
    eventType: string;
    contentMap: SendToDeviceContentMap;
    txnId?: string;
    makeTxnId: () => string;
}

export interface AuthedRequestFn {
    <T>(method: Method, path: string, queryParams?: QueryDict, body?: Body, paramOpts?: IRequestOpts): Promise<T>;
}

export interface SendToDeviceDeps {
    authedRequest: AuthedRequestFn;
    logger: { debug: (...args: unknown[]) => void };
}

export function buildSendToDevicePath(eventType: string, txnId: string): string {
    return encodeUri("/sendToDevice/$eventType/$txnId", {
        $eventType: eventType,
        $txnId: txnId,
    });
}

export function buildSendToDeviceBody(contentMap: SendToDeviceContentMap): {
    body: { messages: Record<string, Record<string, unknown>> };
    targets: Map<string, string[]>;
} {
    const messages: Record<string, Record<string, unknown>> = {};

    const targets = new Map<string, string[]>();
    for (const [userId, deviceMessages] of contentMap) {
        const perUserMessages: Record<string, unknown> = {};
        for (const [deviceId, content] of deviceMessages) {
            perUserMessages[deviceId] = content;
        }
        messages[userId] = perUserMessages;
        targets.set(userId, Array.from(deviceMessages.keys()));
    }

    const body = { messages };
    return { body, targets };
}

export async function sendToDeviceRequest(options: SendToDeviceOptions, deps: SendToDeviceDeps): Promise<EmptyObject> {
    const txnId = options.txnId ?? options.makeTxnId();
    const path = buildSendToDevicePath(options.eventType, txnId);
    const { body, targets } = buildSendToDeviceBody(options.contentMap);

    deps.logger.debug(`PUT ${path}`, targets);

    return deps.authedRequest<EmptyObject>(Method.Put, path, undefined, body);
}
