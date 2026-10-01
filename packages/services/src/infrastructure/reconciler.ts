import type { InstanceRepository, NodeAgentPort, ProvisioningJobRepository } from './ports.js';
import type { InstanceStatus, ProvisioningJobRecord } from './types.js';

type ReconcileResult = { inspected: number; recovered: number; failed: number };

function statusOf(status: string): InstanceStatus {
  if (status === 'RUNNING') return 'ACTIVE';
  if (status === 'STOPPED') return 'STOPPED';
  return 'ERROR';
}

export class InfrastructureReconciler {
  constructor(private readonly dependencies: { jobs: ProvisioningJobRepository; instances: InstanceRepository; agent: NodeAgentPort }) {}

  async reconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = { inspected: 0, recovered: 0, failed: 0 };
    const jobs = await this.dependencies.jobs.listByStatuses(['PENDING', 'RUNNING']);
    const touched = new Set<string>();

    for (const job of jobs) {
      touched.add(job.instanceId);
      const recovered = await this.reconcileJob(job, result);
      if (recovered) result.recovered += 1;
      else result.failed += 1;
    }

    const instances = await this.dependencies.instances.listByStatuses(['PROVISIONING', 'STARTING', 'RESTARTING', 'ACTIVE', 'STOPPED']);
    for (const instance of instances) {
      if (touched.has(instance.id)) continue;
      result.inspected += 1;
      try {
        const inspection = await this.dependencies.agent.inspectInstance(instance.id) as { runtimeId: string; status: string };
        await this.dependencies.instances.updateRuntime(instance.id, inspection.runtimeId, statusOf(inspection.status));
        result.recovered += 1;
      } catch {
        await this.dependencies.instances.updateRuntime(instance.id, instance.runtimeId, 'ERROR');
        result.failed += 1;
      }
    }

    return result;
  }

  private async reconcileJob(job: ProvisioningJobRecord, result: ReconcileResult): Promise<boolean> {
    result.inspected += 1;
    try {
      const inspection = await this.dependencies.agent.inspectInstance(job.instanceId) as { runtimeId: string; status: string };
      await this.dependencies.instances.updateRuntime(job.instanceId, inspection.runtimeId, statusOf(inspection.status));
      if (statusOf(inspection.status) === 'ERROR') {
        await this.dependencies.jobs.markFailed(job.id, 'RUNTIME_ERROR', 'The instance runtime could not be recovered.');
        return false;
      }
      await this.dependencies.jobs.markSucceeded(job.id);
      return true;
    } catch {
      await this.dependencies.instances.updateRuntime(job.instanceId, null, 'ERROR');
      await this.dependencies.jobs.markFailed(job.id, 'RUNTIME_ERROR', 'The instance runtime could not be recovered.');
      return false;
    }
  }
}