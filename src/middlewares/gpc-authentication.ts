import type { Request, Response, NextFunction } from "express";
import type { OAuth2Client } from "google-auth-library";
import { Logger } from "src/core";

export function gcpAuthenticationMiddleware(
  oauth2Client: OAuth2Client,
  config: { audience: string; pubSubServiceAccountEmail: string }
) {
  const AUDIENCE = config.audience;
  const PUBSUB_SERVICE_ACCOUNT_EMAIL = config.pubSubServiceAccountEmail;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        res.status(401).send("Unauthorized: No authorization header");
        return;
      }

      const [, token] = authHeader.split(" ");
      if (!token) {
        res.status(401).send("Unauthorized: No token provided");
        return;
      }

      const ticket = await oauth2Client.verifyIdToken({
        idToken: token,
        audience: AUDIENCE,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        Logger.error("Invalid token payload", {});
        res.status(401).send("Unauthorized: Invalid token payload");
        return;
      }

      if (
        payload.iss !== "accounts.google.com" &&
        payload.iss !== "https://accounts.google.com"
      ) {
        Logger.error("Invalid token issuer", { payload });
        res.status(401).send("Unauthorized: Invalid token issuer");
        return;
      }

      if (payload.aud !== AUDIENCE) {
        Logger.error("Invalid token audience", { payload });
        res.status(401).send("Unauthorized: Invalid token audience");
        return;
      }

      if (payload.email !== PUBSUB_SERVICE_ACCOUNT_EMAIL) {
        Logger.error("Invalid token service account email", { payload });
        res
          .status(401)
          .send("Unauthorized: Invalid token service account email");
        return;
      }

      if (!payload.email_verified) {
        Logger.error("Email not verified", { payload });
        res.status(401).send("Unauthorized: Email not verified");
        return;
      }

      next();
    } catch (error) {
      Logger.error("Error verifying GCP token", {}, error);
      res.status(401).send("Unauthorized: Token verification failed");
      return;
    }
  };
}
