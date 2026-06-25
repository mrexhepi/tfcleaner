import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

/** Create an isolated temp directory and return its path. */
export async function makeTmp(prefix = 'tfclean-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

/** Write a file, creating parent dirs. */
export async function writeFile(p, content = 'x') {
  await fs.ensureDir(path.dirname(p));
  await fs.writeFile(p, content);
}

/**
 * Build a small fake project tree used across tests:
 *
 *   root/
 *     payment-api/
 *       main.tf
 *       .terraform/<files>
 *       .terragrunt-cache/<files>
 *       .terraform.lock.hcl
 *     auth-service/
 *       .terragrunt-cache/<files>
 *     node_modules/<should be ignored>/.terraform/<files>
 *     keep/terraform.tfstate   (must never be deleted)
 */
export async function buildFixture(root) {
  await writeFile(path.join(root, 'payment-api', 'main.tf'), 'resource {}');
  await writeFile(
    path.join(root, 'payment-api', '.terraform', 'providers', 'p.bin'),
    '0'.repeat(1000),
  );
  await writeFile(
    path.join(root, 'payment-api', '.terragrunt-cache', 'abc', 'cache.bin'),
    '0'.repeat(2000),
  );
  await writeFile(
    path.join(root, 'payment-api', '.terraform.lock.hcl'),
    'hash',
  );

  await writeFile(
    path.join(root, 'auth-service', '.terragrunt-cache', 'x', 'c.bin'),
    '0'.repeat(500),
  );

  // Should be ignored.
  await writeFile(
    path.join(root, 'node_modules', 'pkg', '.terraform', 'junk.bin'),
    '0'.repeat(100),
  );

  // Protected files outside target dirs.
  await writeFile(path.join(root, 'keep', 'terraform.tfstate'), 'state');
  await writeFile(path.join(root, 'keep', 'vars.tfvars'), 'v');
}
