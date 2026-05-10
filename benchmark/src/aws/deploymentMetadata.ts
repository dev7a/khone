import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  GetFunctionConfigurationCommand,
  GetFunctionScalingConfigCommand,
  LambdaClient,
  type GetFunctionConfigurationCommandOutput,
} from '@aws-sdk/client-lambda';
import type {
  DeploymentMetadata,
  LambdaCapacityProviderMetadata,
  LambdaFunctionMetadata,
  LambdaScalingMetadata,
} from '../types.js';

function stringValue(value: string | undefined): string | null {
  return value == null || value.length === 0 ? null : value;
}

function capacityProviderFromConfig(
  config: GetFunctionConfigurationCommandOutput,
): LambdaCapacityProviderMetadata | null {
  const lmi = config.CapacityProviderConfig?.LambdaManagedInstancesCapacityProviderConfig;
  if (!lmi) {
    return null;
  }

  return {
    arn: stringValue(lmi.CapacityProviderArn),
    per_execution_environment_max_concurrency: lmi.PerExecutionEnvironmentMaxConcurrency ?? null,
    execution_environment_memory_gib_per_vcpu: lmi.ExecutionEnvironmentMemoryGiBPerVCpu ?? null,
  };
}

function scalingFromConfig(value: {
  MinExecutionEnvironments?: number;
  MaxExecutionEnvironments?: number;
} | undefined): LambdaScalingMetadata | null {
  if (!value) {
    return null;
  }
  return {
    min_execution_environments: value.MinExecutionEnvironments ?? null,
    max_execution_environments: value.MaxExecutionEnvironments ?? null,
  };
}

export async function collectDeploymentMetadata(
  stackName: string,
  region: string | null,
): Promise<DeploymentMetadata> {
  const cfn = new CloudFormationClient(region ? { region } : {});
  const lambda = new LambdaClient(region ? { region } : {});
  const collectionErrors: string[] = [];

  const stackResponse = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = stackResponse.Stacks?.[0];
  const parameters: Record<string, string> = {};
  for (const parameter of stack?.Parameters ?? []) {
    if (parameter.ParameterKey && parameter.ParameterValue != null) {
      parameters[parameter.ParameterKey] = parameter.ParameterValue;
    }
  }

  const resourcesResponse = await cfn.send(new DescribeStackResourcesCommand({ StackName: stackName }));
  const lambdaResources = (resourcesResponse.StackResources ?? [])
    .filter((resource) => resource.ResourceType === 'AWS::Lambda::Function')
    .filter((resource) => resource.LogicalResourceId && resource.PhysicalResourceId)
    .sort((a, b) => String(a.LogicalResourceId).localeCompare(String(b.LogicalResourceId)));

  const functions: LambdaFunctionMetadata[] = [];
  for (const resource of lambdaResources) {
    const logicalId = resource.LogicalResourceId as string;
    const functionName = resource.PhysicalResourceId as string;
    try {
      const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
      const capacityProvider = capacityProviderFromConfig(config);
      let scaling: LambdaScalingMetadata | null = null;
      if (capacityProvider) {
        try {
          const scalingResponse = await lambda.send(
            new GetFunctionScalingConfigCommand({
              FunctionName: functionName,
              // LMI scaling config is attached to the automatically published version.
              Qualifier: '$LATEST.PUBLISHED',
            }),
          );
          scaling = scalingFromConfig(scalingResponse.AppliedFunctionScalingConfig);
        } catch (error) {
          collectionErrors.push(
            `${logicalId}: failed to read function scaling config: ${(error as Error).message}`,
          );
        }
      }

      functions.push({
        logical_id: logicalId,
        function_name: config.FunctionName ?? functionName,
        function_arn: stringValue(config.FunctionArn),
        runtime: stringValue(config.Runtime),
        package_type: stringValue(config.PackageType),
        memory_size_mb: config.MemorySize ?? null,
        timeout_seconds: config.Timeout ?? null,
        architectures: config.Architectures ? [...config.Architectures] : [],
        capacity_provider: capacityProvider,
        scaling,
      });
    } catch (error) {
      collectionErrors.push(`${logicalId}: failed to read function configuration: ${(error as Error).message}`);
      functions.push({
        logical_id: logicalId,
        function_name: functionName,
        function_arn: null,
        runtime: null,
        package_type: null,
        memory_size_mb: null,
        timeout_seconds: null,
        architectures: [],
        capacity_provider: null,
        scaling: null,
      });
    }
  }

  return {
    collected_at: new Date().toISOString(),
    parameters,
    functions,
    collection_errors: collectionErrors,
  };
}
