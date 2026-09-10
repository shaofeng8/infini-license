import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { map, Observable } from 'rxjs'
import { BYPASS_KEY } from '../decorators/bypass.decorator'
import { ResOp } from '../model/response.model'

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
    const bypass = this.reflector.getAllAndOverride<boolean>(BYPASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (bypass) {
      return next.handle()
    }

    return next.handle().pipe(map(data => new ResOp(HttpStatus.OK, data ?? null)))
  }
}
