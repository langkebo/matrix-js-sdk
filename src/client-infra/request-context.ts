import { MatrixClient } from "../client";
import { type Body, type IRequestOpts, Method } from "../http-api/index";
import { type QueryDict } from "../utils";

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
