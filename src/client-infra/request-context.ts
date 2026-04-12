import { MatrixClient } from "../client.ts";
import { type Body, type IRequestOpts, Method } from "../http-api/index.ts";
import { type QueryDict } from "../utils.ts";

export class ClientRequestContext {
    public constructor(private readonly client: MatrixClient) {}

    public authedRequest<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        requestOpts?: IRequestOpts,
    ): Promise<T> {
        return this.client.http.authedRequest<T>(method, path, queryParams, body, requestOpts);
    }
}
