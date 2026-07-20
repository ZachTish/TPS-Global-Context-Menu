import type { App, EventRef, Events } from 'obsidian';
import {
  createTPSGcmIntegrationServiceDescriptor,
  parseTPSGcmIntegrationServiceRequest,
  TPS_GCM_INTEGRATION_SERVICE_EVENTS,
  type TPSGcmIntegrationApi,
  type TPSGcmIntegrationServiceDescriptor,
} from './tps-gcm-integration-contract';

export type TPSGcmIntegrationAssertCurrent = () => void;

export interface TPSGcmIntegrationHostLogger {
  warn(event: string, details: Record<string, unknown>): void;
  flow(event: string, details: Record<string, unknown>): void;
}

const NOOP_LOGGER: TPSGcmIntegrationHostLogger = {
  warn: () => {},
  flow: () => {},
};

/** Owns exact-identity publication and withdrawal of the bounded GCM workspace service. */
export class TPSGcmIntegrationHost {
  private descriptor?: Readonly<TPSGcmIntegrationServiceDescriptor>;
  private requestRef: EventRef | null = null;
  private lifecycleEpoch = 0;

  constructor(
    private readonly app: App,
    private readonly logger: TPSGcmIntegrationHostLogger = NOOP_LOGGER,
  ) {}

  publish(
    createApi: (assertCurrent: TPSGcmIntegrationAssertCurrent) => TPSGcmIntegrationApi,
    registerEvent?: (eventRef: EventRef) => void,
  ): Readonly<TPSGcmIntegrationServiceDescriptor> | undefined {
    this.withdraw('replace');
    const epoch = ++this.lifecycleEpoch;
    let descriptor: Readonly<TPSGcmIntegrationServiceDescriptor> | undefined;
    const assertCurrent = (): void => {
      if (!descriptor
        || epoch !== this.lifecycleEpoch
        || this.descriptor !== descriptor) {
        throw new Error('TPS GCM Integration API is unavailable.');
      }
    };
    const rawApi = createApi(assertCurrent);
    descriptor = createTPSGcmIntegrationServiceDescriptor(rawApi);

    const events = this.app.workspace as Events;
    let requestRef: EventRef | undefined;
    try {
      requestRef = events.on(TPS_GCM_INTEGRATION_SERVICE_EVENTS.REQUEST, (value: unknown) => {
        const request = parseTPSGcmIntegrationServiceRequest(value);
        if (!request
          || epoch !== this.lifecycleEpoch
          || this.descriptor !== descriptor) return;
        try {
          request.accept(descriptor);
        } catch (error) {
          this.logger.warn('request:accept-failed', { error });
        }
      });
      if (!requestRef) throw new Error('TPS GCM Integration request listener was not created.');
      registerEvent?.(requestRef);
    } catch (error) {
      if (requestRef) {
        try {
          this.app.workspace.offref(requestRef);
        } catch {
          // No descriptor was published, so epoch invalidation is sufficient containment.
        }
      }
      this.lifecycleEpoch += 1;
      throw error;
    }

    if (epoch !== this.lifecycleEpoch) {
      try {
        this.app.workspace.offref(requestRef);
      } catch {
        // A superseded listener is inert because its epoch no longer matches.
      }
      return undefined;
    }

    this.descriptor = descriptor;
    this.requestRef = requestRef;
    try {
      this.app.workspace.trigger(TPS_GCM_INTEGRATION_SERVICE_EVENTS.AVAILABLE, descriptor);
    } catch (error) {
      this.logger.warn('available:listener-failed', { error });
    }
    if (epoch !== this.lifecycleEpoch || this.descriptor !== descriptor) return undefined;
    this.logger.flow('available', { apiVersion: descriptor.api.apiVersion });
    return descriptor;
  }

  withdraw(reason: 'replace' | 'reload' | 'unload'): void {
    const descriptor = this.descriptor;
    const requestRef = this.requestRef;
    this.descriptor = undefined;
    this.requestRef = null;
    this.lifecycleEpoch += 1;
    if (descriptor) {
      try {
        this.app.workspace.trigger(TPS_GCM_INTEGRATION_SERVICE_EVENTS.UNAVAILABLE, descriptor);
      } catch (error) {
        this.logger.warn('unavailable:listener-failed', { reason, error });
      }
    }
    if (requestRef) {
      try {
        this.app.workspace.offref(requestRef);
      } catch (error) {
        this.logger.warn('request-listener:remove-failed', { reason, error });
      }
    }
    if (descriptor || requestRef) this.logger.flow('unavailable', { reason });
  }

  getDescriptor(): Readonly<TPSGcmIntegrationServiceDescriptor> | undefined {
    return this.descriptor;
  }
}
