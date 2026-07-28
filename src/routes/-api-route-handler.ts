type ApiRouteHandler<TParams> = (request: Request, context: { params: TParams }) => Response | Promise<Response>;

type StartApiHandlerArgs<TParams> = {
  request: Request;
  params: TParams;
};

export function toStartHandler<TParams>(handler: ApiRouteHandler<TParams>) {
  return ({ request, params }: StartApiHandlerArgs<TParams>) => handler(request, { params });
}
