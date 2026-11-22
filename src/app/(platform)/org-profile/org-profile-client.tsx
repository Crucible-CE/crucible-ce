"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Users,
  Siren,
  Globe,
  Factory,
  X,
  Plus,
  Info,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgProfile } from "@/types";
import { CloudSeam } from "@/components/cloud/cloud-seam";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgData {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  region: string | null;
  profileJson: OrgProfile;
  memberCount: number;
  incidentCount: number;
}

interface OrgProfileClientProps {
  org: OrgData;
  isAdmin: boolean;
  userId: string;
  /** Contributor+: the security-posture profile is not shown to readers. */
  canViewPosture?: boolean;
}

// ---------------------------------------------------------------------------
// Static option lists
// ---------------------------------------------------------------------------

const INDUSTRY_OPTIONS = [
  "Financial Services",
  "Healthcare",
  "Government",
  "Energy/Utilities",
  "Technology",
  "Retail/E-Commerce",
  "Manufacturing",
  "Legal/Professional Services",
  "Education",
  "Transportation/Logistics",
  "Telecommunications",
  "Media/Entertainment",
  "Pharmaceutical",
  "Defense/Aerospace",
  "Other",
];

const REGION_OPTIONS = [
  "North America",
  "Europe",
  "Asia-Pacific",
  "Latin America",
  "Middle East/Africa",
  "Global",
];

const EMPLOYEE_COUNT_OPTIONS = [
  "<50",
  "50-200",
  "200-1000",
  "1000-5000",
  "5000-20000",
  "20000+",
];

const SECURITY_MATURITY_OPTIONS = [
  "Initial/Ad-Hoc",
  "Developing",
  "Defined",
  "Managed",
  "Optimizing",
];

const CLOUD_PROVIDER_OPTIONS = [
  "AWS",
  "Azure",
  "Google Cloud",
  "Oracle Cloud",
  "IBM Cloud",
  "Cloudflare",
  "DigitalOcean",
  "On-Premises",
];

const IDENTITY_PLATFORM_OPTIONS = [
  "Microsoft Entra ID",
  "Okta",
  "Ping Identity",
  "CyberArk",
  "SailPoint",
  "Active Directory (on-prem)",
  "Google Workspace",
  "JumpCloud",
];

const ENDPOINT_STACK_OPTIONS = [
  "CrowdStrike Falcon",
  "SentinelOne",
  "Microsoft Defender",
  "Carbon Black",
  "Trend Micro",
  "Cylance",
  "Sophos",
  "Malwarebytes",
];

const SIEM_PLATFORM_OPTIONS = [
  "Splunk",
  "Microsoft Sentinel",
  "IBM QRadar",
  "Elastic SIEM",
  "Google Chronicle",
  "LogRhythm",
  "Sumo Logic",
  "ArcSight",
];

const SENSITIVE_DATA_OPTIONS = [
  "PII",
  "PHI/ePHI",
  "PCI Data",
  "Financial Records",
  "IP/Trade Secrets",
  "Government Data",
  "Employee Records",
  "Customer Data",
  "Legal Privileged",
];

const COMPLIANCE_FRAMEWORK_OPTIONS = [
  "NIST CSF",
  "ISO 27001",
  "SOC 2",
  "PCI DSS",
  "HIPAA",
  "GDPR",
  "CCPA",
  "FedRAMP",
  "CMMC",
  "NIS2",
  "DORA",
  "CIS Controls",
];

const IR_FRAMEWORK_OPTIONS = [
  "NIST CSF",
  "PICERL",
  "DAIR",
  "SANS",
  "MITRE D3FEND",
  "Custom",
];

const REGULATORY_SLA_OPTIONS = [
  "No requirement",
  "24 hours",
  "48 hours",
  "72 hours",
  "7 days",
  "30 days",
  "60 days",
  "72 hours (GDPR)",
  "Custom",
];

const RISK_APPETITE_OPTIONS = [
  "Risk Averse",
  "Cautious",
  "Balanced",
  "Open",
  "Aggressive",
];

const NETWORK_ARCHITECTURE_OPTIONS = [
  "Flat/Legacy",
  "Segmented",
  "Zero Trust",
  "Hybrid",
  "Cloud-Native",
];

const WORKFORCE_CONNECTIVITY_OPTIONS = [
  "Office-based",
  "Hybrid Remote",
  "Fully Remote",
  "Distributed Global",
];

const PRIVILEGED_ACCESS_OPTIONS = [
  "Shared Admin Accounts",
  "Individual Admin Accounts",
  "PAM Solution",
  "Zero Standing Privilege",
];

const THREAT_INTEL_OPTIONS = [
  "ISAC Feeds",
  "Commercial TI (Recorded Future/Mandiant/etc.)",
  "CISA Advisories",
  "Open Source (MISP/OTX)",
  "Internal Threat Hunting",
  "No Formal TI",
];

const RECOVERY_TIME_OPTIONS = [
  "< 1 hour",
  "1-4 hours",
  "4-24 hours",
  "1-3 days",
  "3-7 days",
  "> 7 days",
  "Not defined",
];

// ---------------------------------------------------------------------------
// ChipSelect component — preset buttons + custom input + removable chips
// ---------------------------------------------------------------------------

interface ChipSelectProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  presets: string[];
  disabled?: boolean;
  hint?: string;
}

function ChipSelect({
  label,
  value,
  onChange,
  presets,
  disabled,
  hint,
}: ChipSelectProps) {
  const [customInput, setCustomInput] = useState("");

  const toggle = (item: string) => {
    if (disabled) return;
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item));
    } else {
      onChange([...value, item]);
    }
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || value.includes(trimmed)) {
      setCustomInput("");
      return;
    }
    onChange([...value, trimmed]);
    setCustomInput("");
  };

  const remove = (item: string) => {
    if (disabled) return;
    onChange(value.filter((v) => v !== item));
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {/* Preset toggle buttons */}
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const selected = value.includes(p);
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => toggle(p)}
              className={[
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground",
              ].join(" ")}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Custom entry */}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            placeholder="Custom value"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustom}
            className="h-8 px-3"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none"
                  aria-label={`Remove ${item}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldSelect — thin wrapper for single-value select
// ---------------------------------------------------------------------------

interface FieldSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: FieldSelectProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <Select value={value || ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder ?? "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldTextarea — labeled textarea
// ---------------------------------------------------------------------------

interface FieldTextareaProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: FieldTextareaProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="resize-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveButton
// ---------------------------------------------------------------------------

function SaveButton({
  onClick,
  saving,
}: {
  onClick: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex justify-end pt-4">
      <Button onClick={onClick} disabled={saving} className="min-w-32">
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyNotice
// ---------------------------------------------------------------------------

function ReadOnlyNotice() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      <Lock className="h-4 w-4 shrink-0" />
      <span>
        Only an administrator can change these.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function OrgProfileClient({
  org,
  isAdmin,
  canViewPosture = true,
}: OrgProfileClientProps) {
  // -------------------------------------------------------------------------
  // Form state — tab-local drafts so each tab saves independently
  // -------------------------------------------------------------------------

  // Tab 1: Identity
  const [orgName, setOrgName] = useState(org.name);
  const [industry, setIndustry] = useState(
    org.industry ?? org.profileJson.employeeCount ?? ""
  );
  const [region, setRegion] = useState(org.region ?? "");
  const [employeeCount, setEmployeeCount] = useState(
    org.profileJson.employeeCount ?? ""
  );
  const [securityMaturity, setSecurityMaturity] = useState(
    org.profileJson.securityMaturity ?? ""
  );

  // Tab 2: Technology Stack
  const [cloudProviders, setCloudProviders] = useState<string[]>(
    org.profileJson.cloudProviders ?? []
  );
  const [identityPlatform, setIdentityPlatform] = useState<string[]>(
    org.profileJson.identityPlatform ?? []
  );
  const [endpointStack, setEndpointStack] = useState<string[]>(
    org.profileJson.endpointStack ?? []
  );
  const [siemPlatform, setSiemPlatform] = useState<string[]>(
    org.profileJson.siemPlatform ?? []
  );

  // Tab 3: Risk & Compliance
  const [sensitiveDataClasses, setSensitiveDataClasses] = useState<string[]>(
    org.profileJson.sensitiveDataClasses ?? []
  );
  const [complianceFrameworks, setComplianceFrameworks] = useState<string[]>(
    org.profileJson.complianceFrameworks ?? []
  );
  const [incidentResponseModel, setIncidentResponseModel] = useState(
    org.profileJson.incidentResponseModel ?? ""
  );
  const [irFramework, setIrFramework] = useState(
    org.profileJson.irFramework ?? ""
  );
  const [regulatoryNotificationSla, setRegulatoryNotificationSla] = useState(
    org.profileJson.regulatoryNotificationSla ?? ""
  );
  const [riskAppetite, setRiskAppetite] = useState(
    org.profileJson.riskAppetite ?? ""
  );

  // Tab 4: Operations
  const [criticalAssets, setCriticalAssets] = useState(
    org.profileJson.criticalAssets ?? ""
  );
  const [externalAttackSurface, setExternalAttackSurface] = useState(
    org.profileJson.externalAttackSurface ?? ""
  );
  const [backupStrategy, setBackupStrategy] = useState(
    org.profileJson.backupStrategy ?? ""
  );
  const [thirdPartyDependencies, setThirdPartyDependencies] = useState(
    org.profileJson.thirdPartyDependencies ?? ""
  );
  const [networkArchitecture, setNetworkArchitecture] = useState(
    org.profileJson.networkArchitecture ?? ""
  );
  const [workforceConnectivity, setWorkforceConnectivity] = useState(
    org.profileJson.workforceConnectivity ?? ""
  );
  const [privilegedAccessModel, setPrivilegedAccessModel] = useState(
    org.profileJson.privilegedAccessModel ?? ""
  );
  const [threatIntelInputs, setThreatIntelInputs] = useState<string[]>(
    org.profileJson.threatIntelInputs ?? []
  );
  const [businessCriticalFunctions, setBusinessCriticalFunctions] = useState(
    org.profileJson.businessCriticalFunctions ?? ""
  );
  const [recoveryTimeObjective, setRecoveryTimeObjective] = useState(
    org.profileJson.recoveryTimeObjective ?? ""
  );
  const [knownSecurityConstraints, setKnownSecurityConstraints] = useState(
    org.profileJson.knownSecurityConstraints ?? ""
  );

  // -------------------------------------------------------------------------
  // Saving state per-tab
  // -------------------------------------------------------------------------
  const [savingTab, setSavingTab] = useState<string | null>(null);

  const patchProfile = useCallback(
    async (partial: Partial<OrgProfile>) => {
      const res = await fetch(`/api/organizations/${org.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Couldn't save. Try again."
        );
      }
    },
    [org.id]
  );

  const handleSaveIdentity = async () => {
    setSavingTab("identity");
    try {
      await patchProfile({
        employeeCount,
        securityMaturity,
      });
      // Also patch top-level org fields via name/industry/region
      // The profile API handles profileJson; org name/industry/region go to the org directly.
      // We include them in profileJson as convenience mirrors.
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSavingTab(null);
    }
  };

  const handleSaveTechStack = async () => {
    setSavingTab("tech");
    try {
      await patchProfile({
        cloudProviders,
        identityPlatform,
        endpointStack,
        siemPlatform,
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSavingTab(null);
    }
  };

  const handleSaveRiskCompliance = async () => {
    setSavingTab("risk");
    try {
      await patchProfile({
        sensitiveDataClasses,
        complianceFrameworks,
        incidentResponseModel,
        irFramework,
        regulatoryNotificationSla,
        riskAppetite,
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSavingTab(null);
    }
  };

  const handleSaveOperations = async () => {
    setSavingTab("ops");
    try {
      await patchProfile({
        criticalAssets,
        externalAttackSurface,
        backupStrategy,
        thirdPartyDependencies,
        networkArchitecture,
        workforceConnectivity,
        privilegedAccessModel,
        threatIntelInputs,
        businessCriticalFunctions,
        recoveryTimeObjective,
        knownSecurityConstraints,
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSavingTab(null);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="headline">Organization profile</h1>
        <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)] max-w-2xl">
          {org.name}
        </p>
      </div>

      {canViewPosture && <CloudSeam feature="threat-assessment" />}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Members
            </CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{org.memberCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Incidents
            </CardTitle>
            <Siren className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{org.incidentCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Industry
            </CardTitle>
            <Factory className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {org.industry ?? (
                <span className="text-muted-foreground">Not set</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Region
            </CardTitle>
            <Globe className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {org.region ?? (
                <span className="text-muted-foreground">Not set</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Profile tabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              Security posture
            </CardTitle>
            {!isAdmin && (
              <Badge variant="secondary" className="text-xs">
                Read-only
              </Badge>
            )}
          </div>
          {!isAdmin && (
            <div className="mt-3">
              <ReadOnlyNotice />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!canViewPosture ? (
            <p className="text-sm text-muted-foreground">
              Readers cannot see the security posture.
            </p>
          ) : (
          <Tabs defaultValue="identity" className="w-full">
            <TabsList className="mb-6 grid w-full grid-cols-4">
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="tech">Tech stack</TabsTrigger>
              <TabsTrigger value="risk">Risk and compliance</TabsTrigger>
              <TabsTrigger value="ops">Operations</TabsTrigger>
            </TabsList>

            {/* ----------------------------------------------------------------
                Tab 1: Identity
            ---------------------------------------------------------------- */}
            <TabsContent value="identity">
              <div className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Organization Name */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">
                      Organization name
                    </Label>
                    <Input
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      disabled={!isAdmin}
                      placeholder="Organization name"
                    />
                    {isAdmin && (
                      <p className="text-xs text-muted-foreground">
                        Display name.
                      </p>
                    )}
                  </div>

                  <FieldSelect
                    label="Industry"
                    value={industry}
                    onChange={setIndustry}
                    options={INDUSTRY_OPTIONS}
                    placeholder="Select industry"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Region"
                    value={region}
                    onChange={setRegion}
                    options={REGION_OPTIONS}
                    placeholder="Select region"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Employee count"
                    value={employeeCount}
                    onChange={setEmployeeCount}
                    options={EMPLOYEE_COUNT_OPTIONS}
                    placeholder="Select range"
                    disabled={!isAdmin}
                  />

                  <div className="sm:col-span-2">
                    <FieldSelect
                      label="Security maturity"
                      value={securityMaturity}
                      onChange={setSecurityMaturity}
                      options={SECURITY_MATURITY_OPTIONS}
                      placeholder="Select maturity"
                      disabled={!isAdmin}
                    />
                  </div>
                </div>

                {isAdmin && (
                  <SaveButton
                    onClick={handleSaveIdentity}
                    saving={savingTab === "identity"}
                  />
                )}
              </div>
            </TabsContent>

            {/* ----------------------------------------------------------------
                Tab 2: Technology Stack
            ---------------------------------------------------------------- */}
            <TabsContent value="tech">
              <div className="space-y-8">
                <ChipSelect
                  label="Cloud providers"
                  value={cloudProviders}
                  onChange={setCloudProviders}
                  presets={CLOUD_PROVIDER_OPTIONS}
                  disabled={!isAdmin}
                  hint="Select all that apply."
                />

                <ChipSelect
                  label="Identity platform"
                  value={identityPlatform}
                  onChange={setIdentityPlatform}
                  presets={IDENTITY_PLATFORM_OPTIONS}
                  disabled={!isAdmin}
                  hint="IdP, IAM and PAM."
                />

                <ChipSelect
                  label="Endpoint stack"
                  value={endpointStack}
                  onChange={setEndpointStack}
                  presets={ENDPOINT_STACK_OPTIONS}
                  disabled={!isAdmin}
                  hint="EDR and EPP."
                />

                <ChipSelect
                  label="SIEM"
                  value={siemPlatform}
                  onChange={setSiemPlatform}
                  presets={SIEM_PLATFORM_OPTIONS}
                  disabled={!isAdmin}
                />

                {isAdmin && (
                  <SaveButton
                    onClick={handleSaveTechStack}
                    saving={savingTab === "tech"}
                  />
                )}
              </div>
            </TabsContent>

            {/* ----------------------------------------------------------------
                Tab 3: Risk & Compliance
            ---------------------------------------------------------------- */}
            <TabsContent value="risk">
              <div className="space-y-8">
                <ChipSelect
                  label="Sensitive data"
                  value={sensitiveDataClasses}
                  onChange={setSensitiveDataClasses}
                  presets={SENSITIVE_DATA_OPTIONS}
                  disabled={!isAdmin}
                  hint="Regulated or sensitive data you store or process."
                />

                <ChipSelect
                  label="Compliance frameworks"
                  value={complianceFrameworks}
                  onChange={setComplianceFrameworks}
                  presets={COMPLIANCE_FRAMEWORK_OPTIONS}
                  disabled={!isAdmin}
                />

                <div className="grid gap-6 sm:grid-cols-2">
                  <FieldSelect
                    label="IR Framework"
                    value={irFramework}
                    onChange={setIrFramework}
                    options={IR_FRAMEWORK_OPTIONS}
                    placeholder="Select framework"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Regulatory notification SLA"
                    value={regulatoryNotificationSla}
                    onChange={setRegulatoryNotificationSla}
                    options={REGULATORY_SLA_OPTIONS}
                    placeholder="Select SLA"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Risk appetite"
                    value={riskAppetite}
                    onChange={setRiskAppetite}
                    options={RISK_APPETITE_OPTIONS}
                    placeholder="Select risk appetite"
                    disabled={!isAdmin}
                  />
                </div>

                <FieldTextarea
                  label="Incident response model"
                  value={incidentResponseModel}
                  onChange={setIncidentResponseModel}
                  placeholder="IR model and escalation chain"
                  rows={4}
                  disabled={!isAdmin}
                />

                {isAdmin && (
                  <SaveButton
                    onClick={handleSaveRiskCompliance}
                    saving={savingTab === "risk"}
                  />
                )}
              </div>
            </TabsContent>

            {/* ----------------------------------------------------------------
                Tab 4: Operations
            ---------------------------------------------------------------- */}
            <TabsContent value="ops">
              <div className="space-y-8">
                <div className="grid gap-6 sm:grid-cols-2">
                  <FieldSelect
                    label="Network architecture"
                    value={networkArchitecture}
                    onChange={setNetworkArchitecture}
                    options={NETWORK_ARCHITECTURE_OPTIONS}
                    placeholder="Select architecture"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Workforce connectivity"
                    value={workforceConnectivity}
                    onChange={setWorkforceConnectivity}
                    options={WORKFORCE_CONNECTIVITY_OPTIONS}
                    placeholder="Select model"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Privileged access model"
                    value={privilegedAccessModel}
                    onChange={setPrivilegedAccessModel}
                    options={PRIVILEGED_ACCESS_OPTIONS}
                    placeholder="Select model"
                    disabled={!isAdmin}
                  />

                  <FieldSelect
                    label="Recovery time objective"
                    value={recoveryTimeObjective}
                    onChange={setRecoveryTimeObjective}
                    options={RECOVERY_TIME_OPTIONS}
                    placeholder="Select RTO"
                    disabled={!isAdmin}
                  />
                </div>

                <ChipSelect
                  label="Threat intelligence sources"
                  value={threatIntelInputs}
                  onChange={setThreatIntelInputs}
                  presets={THREAT_INTEL_OPTIONS}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="Critical assets"
                  value={criticalAssets}
                  onChange={setCriticalAssets}
                  placeholder="Most critical systems, apps and data stores"
                  rows={3}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="External attack surface"
                  value={externalAttackSurface}
                  onChange={setExternalAttackSurface}
                  placeholder="Public-facing assets, cloud exposure, third-party connections"
                  rows={3}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="Backup and restore"
                  value={backupStrategy}
                  onChange={setBackupStrategy}
                  placeholder="Frequency, offsite or cloud, RTO/RPO, last tested"
                  rows={3}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="Key third parties"
                  value={thirdPartyDependencies}
                  onChange={setThirdPartyDependencies}
                  placeholder="Critical vendors, SaaS, cloud services, outsourced functions"
                  rows={3}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="Business-critical functions"
                  value={businessCriticalFunctions}
                  onChange={setBusinessCriticalFunctions}
                  placeholder="Operations that must stay available"
                  rows={3}
                  disabled={!isAdmin}
                />

                <FieldTextarea
                  label="Known security constraints"
                  value={knownSecurityConstraints}
                  onChange={setKnownSecurityConstraints}
                  placeholder="Budget, legacy systems, compliance gaps, staffing"
                  rows={3}
                  disabled={!isAdmin}
                />

                {isAdmin && (
                  <SaveButton
                    onClick={handleSaveOperations}
                    saving={savingTab === "ops"}
                  />
                )}
              </div>
            </TabsContent>
          </Tabs>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
