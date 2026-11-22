// Organization profile (stored as profileJson on the Organization model).
export interface OrgProfile {
  employeeCount?: string;
  securityMaturity?: string;
  cloudProviders?: string[];
  identityPlatform?: string[];
  endpointStack?: string[];
  siemPlatform?: string[];
  criticalAssets?: string;
  sensitiveDataClasses?: string[];
  externalAttackSurface?: string;
  backupStrategy?: string;
  thirdPartyDependencies?: string;
  complianceFrameworks?: string[];
  incidentResponseModel?: string;
  irFramework?: string;
  networkArchitecture?: string;
  workforceConnectivity?: string;
  privilegedAccessModel?: string;
  threatIntelInputs?: string[];
  regulatoryNotificationSla?: string;
  businessCriticalFunctions?: string;
  recoveryTimeObjective?: string;
  knownSecurityConstraints?: string;
  riskAppetite?: string;
  topThreats?: string[];
  threatActorConcerns?: string[];
}
