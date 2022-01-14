import { Aws, Stack } from "aws-cdk-lib";
import { SnakemakeEngine } from "../../constructs/engines/snakemake/snakemake-engine";
import { renderPythonLambda } from "../../util";
import { EngineOptions } from "../../types";
import { ApiProxy, Batch } from "../../constructs";
import { EngineOutputs, EngineConstruct } from "./engine-construct";
import { ILogGroup } from "aws-cdk-lib/aws-logs";
import { ComputeResourceType } from "@aws-cdk/aws-batch-alpha";
import { LAUNCH_TEMPLATE, wesAdapterSourcePath } from "../../constants";
import { Construct } from "constructs";
import { ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { ContextAppParameters } from "../../env";
import { HeadJobBatchPolicy } from "../../roles/policies/head-job-batch-policy";
import { BatchPolicies } from "../../roles/policies/batch-policies";

export class SnakemakeEngineConstruct extends EngineConstruct {
  public readonly apiProxy: ApiProxy;
  public readonly adapterLogGroup: ILogGroup;
  public readonly snakemakeEngine: SnakemakeEngine;
  private readonly batchHead: Batch;
  private readonly batchWorkers: Batch;

  constructor(scope: Construct, id: string, props: EngineOptions) {
    super(scope, id);

    const { vpc, contextParameters } = props;
    const params = props.contextParameters;

    this.batchHead = this.renderBatch("HeadBatch", vpc, contextParameters, ComputeResourceType.FARGATE);
    const workerComputeType = contextParameters.requestSpotInstances ? ComputeResourceType.SPOT : ComputeResourceType.ON_DEMAND;
    this.batchWorkers = this.renderBatch("TaskBatch", vpc, contextParameters, workerComputeType);

    this.batchHead.role.attachInlinePolicy(new HeadJobBatchPolicy(this, "HeadJobBatchPolicy"));
    this.batchHead.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["batch:TagResource"],
        resources: ["*"],
      })
    );

    this.snakemakeEngine = new SnakemakeEngine(this, "SnakemakeEngine", {
      vpc: props.vpc,
      engineBatch: this.batchHead,
      workerBatch: this.batchWorkers,
      rootDirS3Uri: params.getEngineBucketPath(),
    });

    const adapterRole = new Role(this, "SnakemakeAdapterRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole")],
      inlinePolicies: {
        SnakemakeAdapterPolicy: new PolicyDocument({
          statements: [
            BatchPolicies.listAndDescribe,
            new PolicyStatement({
              actions: ["tag:GetResources"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    this.batchHead.grantJobAdministration(adapterRole);
    this.batchWorkers.grantJobAdministration(this.batchHead.role);

    const engineLogGroup = this.snakemakeEngine.logGroup;

    const lambda = this.renderAdapterLambda({
      vpc: props.vpc,
      role: adapterRole,
      jobQueueArn: this.batchHead.jobQueue.jobQueueArn,
      jobDefinitionArn: this.snakemakeEngine.headJobDefinition.jobDefinitionArn,
      engineLogGroupName: engineLogGroup.logGroupName,
    });
    this.adapterLogGroup = lambda.logGroup;

    this.apiProxy = new ApiProxy(this, {
      apiName: `${params.projectName}${params.userId}${params.contextName}SnakemakeApiProxy`,
      lambda,
      allowedAccountIds: [Aws.ACCOUNT_ID],
    });
  }

  protected getOutputs(): EngineOutputs {
    return {
      accessLogGroup: this.apiProxy.accessLogGroup,
      adapterLogGroup: this.adapterLogGroup,
      engineLogGroup: this.snakemakeEngine.logGroup,
      wesUrl: this.apiProxy.restApi.url,
    };
  }

  private renderBatch(id: string, vpc: IVpc, appParams: ContextAppParameters, computeType?: ComputeResourceType): Batch {
    return new Batch(this, id, {
      vpc,
      computeType,
      instanceTypes: appParams.instanceTypes,
      maxVCpus: appParams.maxVCpus,
      launchTemplateData: LAUNCH_TEMPLATE,
      awsPolicyNames: ["AmazonSSMManagedInstanceCore", "CloudWatchAgentServerPolicy"],
      resourceTags: Stack.of(this).tags.tagValues(),
    });
  }

  private renderAdapterLambda({ vpc, role, jobQueueArn, jobDefinitionArn, engineLogGroupName }) {
    return renderPythonLambda(this, "SnakemakeWesAdapterLambda", vpc, role, wesAdapterSourcePath, {
      ENGINE_NAME: "snakemake",
      JOB_QUEUE: jobQueueArn,
      JOB_DEFINITION: jobDefinitionArn,
    });
  }
}
