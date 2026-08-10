import { HttpException } from '@nestjs/common';

export class BearerAuthException extends HttpException {
  constructor(status: 401 | 403, message: string, code?: 'invalid_token' | 'insufficient_scope', scope?: string) {
    super(
      { statusCode: status, error: status === 401 ? 'Unauthorized' : 'Forbidden', message },
      status,
      { cause: undefined },
    );
    const parameters = ['Bearer realm="mcp"'];
    if (code) parameters.push(`error="${code}"`);
    if (scope && code === 'insufficient_scope') parameters.push(`scope="${scope.replace(/["\\]/g, '')}"`);
    this.getResponseHeaders = () => ({ 'WWW-Authenticate': parameters.join(', ') });
  }

  getResponseHeaders(): Record<string, string> { return {}; }
}
