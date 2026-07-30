import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;
const WIREGUARD_KEY_REGEX = /^[A-Za-z0-9+/]{43}=$/;
const PUBLIC_KEY_COLLECTION_REGEX = /^(?:[A-Za-z0-9+/]{43})+$/;

const hexTokenSchema = z.string().regex(HEX_64_REGEX, "Invalid token");
const wireGuardKeySchema = z.string().regex(WIREGUARD_KEY_REGEX);
const citySchema = z.tuple([
  z.string(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]).rest(z.unknown());
const countrySchema = z.tuple([
  z.string(),
  z.string().min(2),
  z.array(citySchema),
]);

const keyRequestBodySchema = z.object({
  token: hexTokenSchema,
}).strict();

export const nordVpnCredentialsSchema = z.object({
  nordlynx_private_key: wireGuardKeySchema,
});

export const serverPayloadSchema = z.tuple([
  z.string().regex(PUBLIC_KEY_COLLECTION_REGEX, "Invalid public key collection"),
  z.array(countrySchema),
]);

export function keyValidator() {
  return zValidator("json", keyRequestBodySchema, (result, context) => {
    if (result.success) {
      return;
    }

    const message = result.error.issues
      .map((issue) => issue.message)
      .join(", ");

    return context.json({ error: message }, 400);
  });
}