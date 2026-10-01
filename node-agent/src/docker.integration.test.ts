import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';

const enabled = process.env.RUN_DOCKER_INTEGRATION === '1';

describe.skipIf(!enabled)('Docker integration', () => {
  it('requires a reachable Docker Engine', async () => {
    const docker = new Docker();
    await expect(docker.ping()).resolves.toBeTruthy();
    await expect(docker.listContainers({ all: true })).resolves.toBeInstanceOf(Array);
  });
});

if (enabled === false) {
  it.skip('Docker integration is opt-in; set RUN_DOCKER_INTEGRATION=1 to execute it', () => undefined);
}
