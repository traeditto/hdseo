import "server-only";

import { ApiError } from "@/lib/api/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import {
  createVercelAutomationBypass,
  type VercelCredentials,
} from "@/lib/vercel/client";

const CONFIG_KEY = "hdSeoAutomationBypass";

type StoredBypass = {
  encryptedSecret?: string;
  createdAt?: string;
  provider?: string;
};

export type VercelEnvironmentConfig = Record<string, unknown>;

function storedBypass(config: VercelEnvironmentConfig): StoredBypass | null {
  const value = config[CONFIG_KEY];
  return value && typeof value === "object" ? value as StoredBypass : null;
}

export async function ensureVercelAutomationBypass(input: {
  credentials: VercelCredentials;
  projectId: string;
  environmentConfig?: VercelEnvironmentConfig | null;
  forceRefresh?: boolean;
}) {
  const environmentConfig = input.environmentConfig ?? {};
  const stored = storedBypass(environmentConfig);
  if (stored?.encryptedSecret && !input.forceRefresh) {
    return {
      secret: decryptSecret(stored.encryptedSecret),
      environmentConfig,
      created: false,
    };
  }

  const generated = await createVercelAutomationBypass(
    input.credentials,
    input.projectId,
  );
  const automationSecrets = Object.entries(generated.protectionBypass ?? {})
    .filter(([, metadata]) => metadata.scope === "automation-bypass")
    .sort(([, left], [, right]) => right.createdAt - left.createdAt);
  const secret = automationSecrets[0]?.[0];
  if (!secret) {
    throw new ApiError(
      "Vercel did not return an automation credential for protected preview validation.",
      502,
      "VERCEL_PROTECTION_BYPASS_FAILED",
    );
  }

  return {
    secret,
    environmentConfig: {
      ...environmentConfig,
      [CONFIG_KEY]: {
        encryptedSecret: encryptSecret(secret),
        createdAt: new Date().toISOString(),
        provider: "vercel",
      },
    },
    created: true,
  };
}
