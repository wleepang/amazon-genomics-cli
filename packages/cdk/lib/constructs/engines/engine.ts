import { ILogGroup, LogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { AccessPoint, FileSystem, PerformanceMode } from "aws-cdk-lib/aws-efs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface EngineProps {
  readonly vpc: IVpc;
  readonly rootDirS3Uri: string;
}

export class Engine extends Construct {
  readonly logGroup: ILogGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.logGroup = new LogGroup(this, "EngineLogGroup");
  }

  protected toMountPoint(containerPath: string, volumeName: string) {
    return {
      sourceVolume: volumeName,
      containerPath: containerPath,
      readOnly: false,
    };
  }

  protected toVolume(fileSystem: FileSystem, accessPoint: AccessPoint, volumeName: string) {
    return {
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: "ENABLED",
        },
      },
    };
  }

  protected createAccessPoint(fileSystem: FileSystem) {
    return new AccessPoint(this, "AccessPoint", {
      fileSystem: fileSystem,
      posixUser: {
        uid: "0",
        gid: "0",
      },
    });
  }

  protected createAccessPointcreateFileSystem(vpc: IVpc) {
    return new FileSystem(this, "FileSystem", {
      vpc: vpc,
      encrypted: true,
      performanceMode: PerformanceMode.MAX_IO,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  protected createFileSystem(vpc: IVpc) {
    return new FileSystem(this, "FileSystem", {
      vpc: vpc,
      encrypted: true,
      performanceMode: PerformanceMode.MAX_IO,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
