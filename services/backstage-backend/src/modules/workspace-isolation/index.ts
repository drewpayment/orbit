import { createBackendModule } from '@backstage/backend-plugin-api';
import { coreServices } from '@backstage/backend-plugin-api';
import express from 'express';

/**
 * Workspace Isolation Middleware
 *
 * Ensures all requests to Backstage include a workspace ID header for multi-tenant isolation.
 * For Phase 1 (MVP), this validates the header exists but doesn't enforce strict isolation.
 * Future: Will route to correct Backstage instance based on workspace ID.
 */
export const workspaceIsolationModule = createBackendModule({
  pluginId: 'app',
  moduleId: 'workspace-isolation',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
      },
      async init({ logger, httpRouter }) {
        const middleware = async (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          const workspaceId = req.headers['x-orbit-workspace-id'];

          // For MVP Phase 1: Log warning but allow requests without workspace ID
          // This will be enforced strictly in later phases
          if (!workspaceId) {
            logger.warn('Request missing x-orbit-workspace-id header', {
              path: req.path,
              method: req.method,
            });
            // For MVP, allow the request to proceed
            // TODO: In production, return 400 error
            // return res.status(400).json({
            //   error: 'Missing x-orbit-workspace-id header'
            // });
          }

          // Attach workspace context to request for plugins to use
          (req as any).workspaceContext = {
            workspaceId: workspaceId as string || 'default',
          };

          logger.debug('Workspace context attached', {
            workspaceId: (req as any).workspaceContext.workspaceId,
            path: req.path,
          });

          next();
        };

        httpRouter.use(middleware);

        logger.info('Workspace isolation middleware registered');
      },
    });
  },
});

export default workspaceIsolationModule;
