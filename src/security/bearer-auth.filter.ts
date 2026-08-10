import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { BearerAuthException } from './auth.exceptions';

@Catch(BearerAuthException)
export class BearerAuthFilter implements ExceptionFilter {
  catch(exception: BearerAuthException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    for (const [name, value] of Object.entries(exception.getResponseHeaders())) reply.header(name, value);
    reply.status(exception.getStatus()).send(exception.getResponse());
  }
}
