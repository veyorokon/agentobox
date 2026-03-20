/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** Date with time (isoformat) */
  DateTime: { input: string; output: string; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](https://ecma-international.org/wp-content/uploads/ECMA-404_2nd_edition_december_2017.pdf). */
  JSON: { input: unknown; output: unknown; }
  UUID: { input: string; output: string; }
};

export type AccountSecretType = {
  __typename?: 'AccountSecretType';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['UUID']['output'];
  key: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type AgentFeedbackType = {
  __typename?: 'AgentFeedbackType';
  agentId: Scalars['String']['output'];
  comment: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['UUID']['output'];
  rating: Scalars['Int']['output'];
  sessionId: Scalars['String']['output'];
};

export type AgentTaskType = {
  __typename?: 'AgentTaskType';
  activeForm: Scalars['String']['output'];
  assignee: Scalars['String']['output'];
  blockedBy: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  status: Scalars['String']['output'];
  taskId: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type AgentType = {
  __typename?: 'AgentType';
  allowedTools: Array<Scalars['String']['output']>;
  attentionLevel: Scalars['String']['output'];
  computeSeconds: Scalars['Int']['output'];
  cost: Scalars['Float']['output'];
  duration: Scalars['String']['output'];
  errorMessage: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  instructions: Scalars['String']['output'];
  lastOutput: Scalars['String']['output'];
  lifecycleAttempts: Array<LifecycleAttemptType>;
  lifecycleStatus: Scalars['String']['output'];
  liveAction?: Maybe<Scalars['String']['output']>;
  mcpServers: Array<Scalars['String']['output']>;
  mode: Scalars['String']['output'];
  model: Scalars['String']['output'];
  name: Scalars['String']['output'];
  phase: Scalars['String']['output'];
  previewRuntimeId: Scalars['String']['output'];
  previewState: Scalars['String']['output'];
  relayConnected: Scalars['Boolean']['output'];
  role: Scalars['String']['output'];
  runtime: Scalars['String']['output'];
  tags: Scalars['JSON']['output'];
  task: Scalars['String']['output'];
  taskProgress?: Maybe<TaskProgressType>;
  tasks: Array<AgentTaskType>;
  triggers: Scalars['JSON']['output'];
  turns: Scalars['Int']['output'];
  workspacePath: Scalars['String']['output'];
};

export type AnswerQuestionInput = {
  agentId: Scalars['ID']['input'];
  answerText: Scalars['String']['input'];
  toolUseId: Scalars['String']['input'];
};

export type AuthPayload = {
  __typename?: 'AuthPayload';
  token: Scalars['String']['output'];
  user: UserType;
};

export type CreateAgentInput = {
  agentType?: Scalars['String']['input'];
  instructions?: Scalars['String']['input'];
  mcpServers?: InputMaybe<Scalars['JSON']['input']>;
  mode?: Scalars['String']['input'];
  model?: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
  role?: Scalars['String']['input'];
  runtime?: Scalars['String']['input'];
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  triggers?: InputMaybe<Scalars['JSON']['input']>;
  volumeMounts?: InputMaybe<Array<VolumeMountInput>>;
  workspacePath?: Scalars['String']['input'];
};

export type CreateProjectInput = {
  description?: Scalars['String']['input'];
  name: Scalars['String']['input'];
};

export type CreateSkillInput = {
  assignedTags?: InputMaybe<Array<Scalars['String']['input']>>;
  assignedToAll?: Scalars['Boolean']['input'];
  content: Scalars['String']['input'];
  description?: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
};

export type FeedQuestionType = {
  __typename?: 'FeedQuestionType';
  options: Array<Scalars['String']['output']>;
  text: Scalars['String']['output'];
};

export type LifecycleAttemptType = {
  __typename?: 'LifecycleAttemptType';
  attemptNo: Scalars['Int']['output'];
  correlationId: Scalars['String']['output'];
  errorCode: Scalars['String']['output'];
  errorDetail: Scalars['String']['output'];
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['UUID']['output'];
  kind: Scalars['String']['output'];
  startedAt: Scalars['DateTime']['output'];
  status: Scalars['String']['output'];
  step: Scalars['String']['output'];
};

export type LoginInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type McpPackageType = {
  __typename?: 'McpPackageType';
  identifier: Scalars['String']['output'];
  registryType: Scalars['String']['output'];
  transportType: Scalars['String']['output'];
};

export type McpRegistryEntryType = {
  __typename?: 'McpRegistryEntryType';
  compat: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type McpRegistrySearchResult = {
  __typename?: 'McpRegistrySearchResult';
  nextCursor?: Maybe<Scalars['String']['output']>;
  servers: Array<McpRegistryServerType>;
};

export type McpRegistryServerType = {
  __typename?: 'McpRegistryServerType';
  description: Scalars['String']['output'];
  hasRemote: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  packages: Array<McpPackageType>;
  version: Scalars['String']['output'];
  websiteUrl?: Maybe<Scalars['String']['output']>;
};

export type ModelEntryType = {
  __typename?: 'ModelEntryType';
  label: Scalars['String']['output'];
  provider: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  answerQuestion: Scalars['Boolean']['output'];
  archiveProject: ProjectType;
  clearAgentSession: Scalars['Boolean']['output'];
  createAgent: AgentType;
  createApiKey: Scalars['String']['output'];
  createProject: ProjectType;
  createSkill: SkillType;
  createTask: AgentTaskType;
  createVncToken: VncTokenResult;
  deleteAccountSecret: Scalars['Boolean']['output'];
  deleteProject: Scalars['Boolean']['output'];
  deleteSecret: Scalars['Boolean']['output'];
  deleteSkill: Scalars['Boolean']['output'];
  hardRestartAgent: AgentType;
  interruptAgent: Scalars['Boolean']['output'];
  killAgent: Scalars['Boolean']['output'];
  login: AuthPayload;
  rateAgent?: Maybe<AgentFeedbackType>;
  register: AuthPayload;
  removeAgent: Scalars['Boolean']['output'];
  resolvePermission: TeamFeedItemType;
  resolvePlan: TeamFeedItemType;
  restartAgent: Scalars['Boolean']['output'];
  scopeSecret: ProjectSecretType;
  sendMessage: Scalars['Boolean']['output'];
  setAccountSecret: AccountSecretType;
  setAgentMode: AgentType;
  setProjectTheme: Scalars['Boolean']['output'];
  setSecret: ProjectSecretType;
  stopAllAgents: Scalars['Int']['output'];
  unarchiveProject: ProjectType;
  updateAgentConfig: AgentType;
  updateAgentInstructions: AgentType;
  updateProject: ProjectType;
  updateSkill: SkillType;
  updateTask: AgentTaskType;
};


export type MutationAnswerQuestionArgs = {
  input: AnswerQuestionInput;
};


export type MutationArchiveProjectArgs = {
  id: Scalars['ID']['input'];
};


export type MutationClearAgentSessionArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationCreateAgentArgs = {
  input: CreateAgentInput;
};


export type MutationCreateProjectArgs = {
  input: CreateProjectInput;
};


export type MutationCreateSkillArgs = {
  input: CreateSkillInput;
};


export type MutationCreateTaskArgs = {
  agentId: Scalars['ID']['input'];
  description?: Scalars['String']['input'];
  title: Scalars['String']['input'];
};


export type MutationCreateVncTokenArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationDeleteAccountSecretArgs = {
  key: Scalars['String']['input'];
};


export type MutationDeleteProjectArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSecretArgs = {
  key: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
};


export type MutationDeleteSkillArgs = {
  skillId: Scalars['ID']['input'];
};


export type MutationHardRestartAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationInterruptAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationKillAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationRateAgentArgs = {
  input: RateFeedbackInput;
};


export type MutationRegisterArgs = {
  input: RegisterInput;
};


export type MutationRemoveAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationResolvePermissionArgs = {
  alwaysAllow?: Scalars['Boolean']['input'];
  feedItemId: Scalars['ID']['input'];
  verdict: Scalars['String']['input'];
};


export type MutationResolvePlanArgs = {
  feedItemId: Scalars['ID']['input'];
  verdict: Scalars['String']['input'];
};


export type MutationRestartAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationScopeSecretArgs = {
  input: ScopeSecretInput;
};


export type MutationSendMessageArgs = {
  projectId: Scalars['ID']['input'];
  recipients: Array<RecipientInput>;
  text: Scalars['String']['input'];
};


export type MutationSetAccountSecretArgs = {
  input: SetAccountSecretInput;
};


export type MutationSetAgentModeArgs = {
  agentId: Scalars['ID']['input'];
  mode: Scalars['String']['input'];
};


export type MutationSetProjectThemeArgs = {
  input: SetProjectThemeInput;
};


export type MutationSetSecretArgs = {
  input: SetSecretInput;
};


export type MutationStopAllAgentsArgs = {
  projectId: Scalars['ID']['input'];
};


export type MutationUnarchiveProjectArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateAgentConfigArgs = {
  input: UpdateAgentConfigInput;
};


export type MutationUpdateAgentInstructionsArgs = {
  input: UpdateAgentInstructionsInput;
};


export type MutationUpdateProjectArgs = {
  input: UpdateProjectInput;
};


export type MutationUpdateSkillArgs = {
  input: UpdateSkillInput;
};


export type MutationUpdateTaskArgs = {
  agentId: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  taskId: Scalars['String']['input'];
};

export type ProjectSecretType = {
  __typename?: 'ProjectSecretType';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['UUID']['output'];
  key: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  scopedAgentIds: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProjectType = {
  __typename?: 'ProjectType';
  archivedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  settings: Scalars['JSON']['output'];
  themeDocument: Scalars['JSON']['output'];
  themeTokens: Scalars['JSON']['output'];
};

export type ProviderStatusType = {
  __typename?: 'ProviderStatusType';
  configured: Scalars['Boolean']['output'];
  keyName: Scalars['String']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  accountSecrets: Array<AccountSecretType>;
  agent?: Maybe<AgentType>;
  agentFeed: Array<TimelineEntryType>;
  agents: Array<AgentType>;
  availableModels: Array<ModelEntryType>;
  mcpRegistry: Array<McpRegistryEntryType>;
  me?: Maybe<UserType>;
  project?: Maybe<ProjectType>;
  projectFeed: Array<TimelineEntryType>;
  projectSecrets: Array<ProjectSecretType>;
  projects: Array<ProjectType>;
  providerStatus: Array<ProviderStatusType>;
  searchMcpRegistry: McpRegistrySearchResult;
  skills: Array<SkillType>;
  teamFeed: Array<TeamFeedItemType>;
};


export type QueryAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type QueryAgentFeedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  agentId: Scalars['ID']['input'];
  first?: Scalars['Int']['input'];
};


export type QueryAgentsArgs = {
  projectId: Scalars['ID']['input'];
};


export type QueryProjectArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProjectFeedArgs = {
  limit?: Scalars['Int']['input'];
  projectId: Scalars['ID']['input'];
};


export type QueryProjectSecretsArgs = {
  projectId: Scalars['ID']['input'];
};


export type QueryProjectsArgs = {
  includeArchived?: Scalars['Boolean']['input'];
};


export type QueryProviderStatusArgs = {
  projectId: Scalars['ID']['input'];
};


export type QuerySearchMcpRegistryArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: Scalars['Int']['input'];
  query?: Scalars['String']['input'];
};


export type QuerySkillsArgs = {
  projectId: Scalars['ID']['input'];
};


export type QueryTeamFeedArgs = {
  projectId: Scalars['ID']['input'];
};

export type RateFeedbackInput = {
  agentId: Scalars['ID']['input'];
  comment?: Scalars['String']['input'];
  messageId?: InputMaybe<Scalars['ID']['input']>;
  rating: Scalars['Int']['input'];
};

export type RecipientInput = {
  type: Scalars['String']['input'];
  value?: Scalars['String']['input'];
};

export type RegisterInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type ScopeSecretInput = {
  agentIds: Array<Scalars['ID']['input']>;
  key: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
};

export type SetAccountSecretInput = {
  key: Scalars['String']['input'];
  value: Scalars['String']['input'];
};

export type SetProjectThemeInput = {
  mode?: InputMaybe<Scalars['String']['input']>;
  overrides?: InputMaybe<Scalars['JSON']['input']>;
  projectId: Scalars['ID']['input'];
  theme?: InputMaybe<Scalars['String']['input']>;
  tokens?: InputMaybe<Scalars['JSON']['input']>;
};

export type SetSecretInput = {
  key: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
  value: Scalars['String']['input'];
};

export type SkillType = {
  __typename?: 'SkillType';
  assignedTags: Scalars['JSON']['output'];
  assignedToAll: Scalars['Boolean']['output'];
  content: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type TaskProgressType = {
  __typename?: 'TaskProgressType';
  done: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type TeamFeedItemType = {
  __typename?: 'TeamFeedItemType';
  agent?: Maybe<Scalars['String']['output']>;
  agentId?: Maybe<Scalars['String']['output']>;
  command?: Maybe<Scalars['String']['output']>;
  cost?: Maybe<Scalars['Float']['output']>;
  duration?: Maybe<Scalars['String']['output']>;
  from?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isError?: Maybe<Scalars['Boolean']['output']>;
  options?: Maybe<Array<Scalars['String']['output']>>;
  permStatus?: Maybe<Scalars['String']['output']>;
  plan?: Maybe<Scalars['String']['output']>;
  planStatus?: Maybe<Scalars['String']['output']>;
  question?: Maybe<Scalars['String']['output']>;
  questions?: Maybe<Array<FeedQuestionType>>;
  risk?: Maybe<Scalars['String']['output']>;
  summary?: Maybe<Scalars['String']['output']>;
  target?: Maybe<Scalars['String']['output']>;
  text?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  to?: Maybe<Scalars['String']['output']>;
  turns?: Maybe<Scalars['Int']['output']>;
  type: Scalars['String']['output'];
};

export type TimelineEntryType = {
  __typename?: 'TimelineEntryType';
  agentId: Scalars['String']['output'];
  agentName: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  data: Scalars['JSON']['output'];
  entryType: Scalars['String']['output'];
  id: Scalars['String']['output'];
  summary?: Maybe<Scalars['String']['output']>;
};

export type UpdateAgentConfigInput = {
  agentId: Scalars['ID']['input'];
  mcpCustomServers?: InputMaybe<Scalars['JSON']['input']>;
  mcpRegistryNames?: InputMaybe<Array<Scalars['String']['input']>>;
  model?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  triggers?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateAgentInstructionsInput = {
  agentId: Scalars['ID']['input'];
  instructions: Scalars['String']['input'];
};

export type UpdateProjectInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  settings?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateSkillInput = {
  assignedTags?: InputMaybe<Array<Scalars['String']['input']>>;
  assignedToAll?: InputMaybe<Scalars['Boolean']['input']>;
  content?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  skillId: Scalars['ID']['input'];
};

export type UserType = {
  __typename?: 'UserType';
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

export type VncTokenResult = {
  __typename?: 'VncTokenResult';
  expiresAt: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type VolumeMountInput = {
  hostPath?: Scalars['String']['input'];
  mountPath: Scalars['String']['input'];
  name: Scalars['String']['input'];
  readOnly?: Scalars['Boolean']['input'];
};

export type SetAgentModeMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  mode: Scalars['String']['input'];
}>;


export type SetAgentModeMutation = { __typename?: 'Mutation', setAgentMode: { __typename?: 'AgentType', id: string, mode: string } };

export type ResolvePermissionMutationVariables = Exact<{
  feedItemId: Scalars['ID']['input'];
  verdict: Scalars['String']['input'];
  alwaysAllow?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type ResolvePermissionMutation = { __typename?: 'Mutation', resolvePermission: { __typename?: 'TeamFeedItemType', id: string, permStatus?: string | null } };

export type ResolvePlanMutationVariables = Exact<{
  feedItemId: Scalars['ID']['input'];
  verdict: Scalars['String']['input'];
}>;


export type ResolvePlanMutation = { __typename?: 'Mutation', resolvePlan: { __typename?: 'TeamFeedItemType', id: string, planStatus?: string | null } };

export type KillAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type KillAgentMutation = { __typename?: 'Mutation', killAgent: boolean };

export type RemoveAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type RemoveAgentMutation = { __typename?: 'Mutation', removeAgent: boolean };

export type HardRestartAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type HardRestartAgentMutation = { __typename?: 'Mutation', hardRestartAgent: { __typename?: 'AgentType', id: string, lifecycleStatus: string } };

export type RestartAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type RestartAgentMutation = { __typename?: 'Mutation', restartAgent: boolean };

export type InterruptAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type InterruptAgentMutation = { __typename?: 'Mutation', interruptAgent: boolean };

export type UpdateAgentInstructionsMutationVariables = Exact<{
  input: UpdateAgentInstructionsInput;
}>;


export type UpdateAgentInstructionsMutation = { __typename?: 'Mutation', updateAgentInstructions: { __typename?: 'AgentType', id: string, instructions: string } };

export type UpdateAgentConfigMutationVariables = Exact<{
  input: UpdateAgentConfigInput;
}>;


export type UpdateAgentConfigMutation = { __typename?: 'Mutation', updateAgentConfig: { __typename?: 'AgentType', id: string, model: string, role: string, tags: unknown, mcpServers: Array<string> } };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { __typename?: 'Mutation', createAgent: { __typename?: 'AgentType', id: string, name: string, lifecycleStatus: string, previewState: string, previewRuntimeId: string, attentionLevel: string, mode: string, task: string, cost: number, duration: string, model: string, turns: number, phase: string, liveAction?: string | null, lastOutput: string, tags: unknown, instructions: string, mcpServers: Array<string>, runtime: string, workspacePath: string, taskProgress?: { __typename?: 'TaskProgressType', done: number, total: number } | null } };

export type SendMessageMutationVariables = Exact<{
  projectId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
  recipients: Array<RecipientInput> | RecipientInput;
}>;


export type SendMessageMutation = { __typename?: 'Mutation', sendMessage: boolean };

export type CreateProjectMutationVariables = Exact<{
  input: CreateProjectInput;
}>;


export type CreateProjectMutation = { __typename?: 'Mutation', createProject: { __typename?: 'ProjectType', id: string, name: string, description: string, createdAt: string } };

export type SetProjectThemeMutationVariables = Exact<{
  input: SetProjectThemeInput;
}>;


export type SetProjectThemeMutation = { __typename?: 'Mutation', setProjectTheme: boolean };

export type SetAccountSecretMutationVariables = Exact<{
  input: SetAccountSecretInput;
}>;


export type SetAccountSecretMutation = { __typename?: 'Mutation', setAccountSecret: { __typename?: 'AccountSecretType', id: string, key: string, createdAt: string, updatedAt: string } };

export type DeleteAccountSecretMutationVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type DeleteAccountSecretMutation = { __typename?: 'Mutation', deleteAccountSecret: boolean };

export type SetSecretMutationVariables = Exact<{
  input: SetSecretInput;
}>;


export type SetSecretMutation = { __typename?: 'Mutation', setSecret: { __typename?: 'ProjectSecretType', id: string, key: string, createdAt: string, updatedAt: string } };

export type DeleteSecretMutationVariables = Exact<{
  projectId: Scalars['ID']['input'];
  key: Scalars['String']['input'];
}>;


export type DeleteSecretMutation = { __typename?: 'Mutation', deleteSecret: boolean };

export type CreateSkillMutationVariables = Exact<{
  input: CreateSkillInput;
}>;


export type CreateSkillMutation = { __typename?: 'Mutation', createSkill: { __typename?: 'SkillType', id: string, name: string, description: string, content: string, assignedTags: unknown, assignedToAll: boolean, createdAt: string, updatedAt: string } };

export type UpdateSkillMutationVariables = Exact<{
  input: UpdateSkillInput;
}>;


export type UpdateSkillMutation = { __typename?: 'Mutation', updateSkill: { __typename?: 'SkillType', id: string, name: string, description: string, content: string, assignedTags: unknown, assignedToAll: boolean, createdAt: string, updatedAt: string } };

export type DeleteSkillMutationVariables = Exact<{
  skillId: Scalars['ID']['input'];
}>;


export type DeleteSkillMutation = { __typename?: 'Mutation', deleteSkill: boolean };

export type UpdateTaskMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  taskId: Scalars['String']['input'];
  status: Scalars['String']['input'];
}>;


export type UpdateTaskMutation = { __typename?: 'Mutation', updateTask: { __typename?: 'AgentTaskType', taskId: string, status: string, updatedAt: string } };

export type CreateTaskMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
  description: Scalars['String']['input'];
}>;


export type CreateTaskMutation = { __typename?: 'Mutation', createTask: { __typename?: 'AgentTaskType', taskId: string, title: string, description: string, status: string, assignee: string, activeForm: string, blockedBy: Array<string>, createdAt: string, updatedAt: string } };

export type CreateVncTokenMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type CreateVncTokenMutation = { __typename?: 'Mutation', createVncToken: { __typename?: 'VncTokenResult', token: string, expiresAt: string } };

export type SearchMcpRegistryQueryVariables = Exact<{
  query?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type SearchMcpRegistryQuery = { __typename?: 'Query', searchMcpRegistry: { __typename?: 'McpRegistrySearchResult', nextCursor?: string | null, servers: Array<{ __typename?: 'McpRegistryServerType', name: string, description: string, version: string, websiteUrl?: string | null, hasRemote: boolean, packages: Array<{ __typename?: 'McpPackageType', registryType: string, identifier: string, transportType: string }> }> } };

export type GetAgentsQueryVariables = Exact<{
  projectId: Scalars['ID']['input'];
}>;


export type GetAgentsQuery = { __typename?: 'Query', agents: Array<{ __typename?: 'AgentType', id: string, name: string, lifecycleStatus: string, previewState: string, previewRuntimeId: string, attentionLevel: string, relayConnected: boolean, mode: string, task: string, cost: number, duration: string, model: string, turns: number, phase: string, liveAction?: string | null, lastOutput: string, errorMessage: string, tags: unknown, instructions: string, mcpServers: Array<string>, runtime: string, workspacePath: string, triggers: unknown, computeSeconds: number, taskProgress?: { __typename?: 'TaskProgressType', done: number, total: number } | null, tasks: Array<{ __typename?: 'AgentTaskType', taskId: string, title: string, description: string, status: string, assignee: string, activeForm: string, blockedBy: Array<string>, createdAt: string, updatedAt: string }> }> };

export type GetAgentFeedQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetAgentFeedQuery = { __typename?: 'Query', agentFeed: Array<{ __typename?: 'TimelineEntryType', id: string, entryType: string, agentId: string, agentName: string, summary?: string | null, data: unknown, createdAt: string }> };

export type GetFeedQueryVariables = Exact<{
  projectId: Scalars['ID']['input'];
}>;


export type GetFeedQuery = { __typename?: 'Query', feed: Array<{ __typename?: 'TeamFeedItemType', id: string, type: string, agent?: string | null, agentId?: string | null, text?: string | null, command?: string | null, risk?: string | null, permStatus?: string | null, title?: string | null, plan?: string | null, planStatus?: string | null, summary?: string | null, cost?: number | null, turns?: number | null, duration?: string | null, from?: string | null, to?: string | null, target?: string | null, question?: string | null, options?: Array<string> | null, isError?: boolean | null, questions?: Array<{ __typename?: 'FeedQuestionType', text: string, options: Array<string> }> | null }> };

export type AvailableModelsQueryVariables = Exact<{ [key: string]: never; }>;


export type AvailableModelsQuery = { __typename?: 'Query', availableModels: Array<{ __typename?: 'ModelEntryType', value: string, label: string, provider: string }> };

export type ProviderStatusQueryVariables = Exact<{
  projectId: Scalars['ID']['input'];
}>;


export type ProviderStatusQuery = { __typename?: 'Query', providerStatus: Array<{ __typename?: 'ProviderStatusType', slug: string, name: string, keyName: string, configured: boolean }> };

export type GetProjectsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetProjectsQuery = { __typename?: 'Query', projects: Array<{ __typename?: 'ProjectType', id: string, name: string, description: string, createdAt: string }> };

export type GetProjectQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetProjectQuery = { __typename?: 'Query', project?: { __typename?: 'ProjectType', id: string, name: string, description: string, themeDocument: unknown, themeTokens: unknown } | null };

export type GetAccountSecretsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetAccountSecretsQuery = { __typename?: 'Query', accountSecrets: Array<{ __typename?: 'AccountSecretType', id: string, key: string, createdAt: string, updatedAt: string }> };

export type GetProjectSecretsQueryVariables = Exact<{
  projectId: Scalars['ID']['input'];
}>;


export type GetProjectSecretsQuery = { __typename?: 'Query', projectSecrets: Array<{ __typename?: 'ProjectSecretType', id: string, key: string, createdAt: string, updatedAt: string }> };

export type GetSkillsQueryVariables = Exact<{
  projectId: Scalars['ID']['input'];
}>;


export type GetSkillsQuery = { __typename?: 'Query', skills: Array<{ __typename?: 'SkillType', id: string, name: string, description: string, content: string, assignedTags: unknown, assignedToAll: boolean, createdAt: string, updatedAt: string }> };

export type GetAgentTasksQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type GetAgentTasksQuery = { __typename?: 'Query', agent?: { __typename?: 'AgentType', id: string, tasks: Array<{ __typename?: 'AgentTaskType', taskId: string, title: string, description: string, status: string, assignee: string, activeForm: string, blockedBy: Array<string>, createdAt: string, updatedAt: string }> } | null };


export const SetAgentModeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentMode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mode"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentMode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"mode"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mode"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"mode"}}]}}]}}]} as unknown as DocumentNode<SetAgentModeMutation, SetAgentModeMutationVariables>;
export const ResolvePermissionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolvePermission"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"feedItemId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"verdict"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"alwaysAllow"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolvePermission"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"feedItemId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"feedItemId"}}},{"kind":"Argument","name":{"kind":"Name","value":"verdict"},"value":{"kind":"Variable","name":{"kind":"Name","value":"verdict"}}},{"kind":"Argument","name":{"kind":"Name","value":"alwaysAllow"},"value":{"kind":"Variable","name":{"kind":"Name","value":"alwaysAllow"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"permStatus"}}]}}]}}]} as unknown as DocumentNode<ResolvePermissionMutation, ResolvePermissionMutationVariables>;
export const ResolvePlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolvePlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"feedItemId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"verdict"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolvePlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"feedItemId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"feedItemId"}}},{"kind":"Argument","name":{"kind":"Name","value":"verdict"},"value":{"kind":"Variable","name":{"kind":"Name","value":"verdict"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planStatus"}}]}}]}}]} as unknown as DocumentNode<ResolvePlanMutation, ResolvePlanMutationVariables>;
export const KillAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"KillAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"killAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<KillAgentMutation, KillAgentMutationVariables>;
export const RemoveAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<RemoveAgentMutation, RemoveAgentMutationVariables>;
export const HardRestartAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"HardRestartAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hardRestartAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}}]}}]}}]} as unknown as DocumentNode<HardRestartAgentMutation, HardRestartAgentMutationVariables>;
export const RestartAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RestartAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"restartAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<RestartAgentMutation, RestartAgentMutationVariables>;
export const InterruptAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InterruptAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"interruptAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<InterruptAgentMutation, InterruptAgentMutationVariables>;
export const UpdateAgentInstructionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentInstructions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAgentInstructionsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentInstructions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"instructions"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentInstructionsMutation, UpdateAgentInstructionsMutationVariables>;
export const UpdateAgentConfigDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentConfig"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAgentConfigInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentConfig"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"mcpServers"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentConfigMutation, UpdateAgentConfigMutationVariables>;
export const CreateAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}},{"kind":"Field","name":{"kind":"Name","value":"previewState"}},{"kind":"Field","name":{"kind":"Name","value":"previewRuntimeId"}},{"kind":"Field","name":{"kind":"Name","value":"attentionLevel"}},{"kind":"Field","name":{"kind":"Name","value":"mode"}},{"kind":"Field","name":{"kind":"Name","value":"task"}},{"kind":"Field","name":{"kind":"Name","value":"cost"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"turns"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"liveAction"}},{"kind":"Field","name":{"kind":"Name","value":"lastOutput"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"mcpServers"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"workspacePath"}},{"kind":"Field","name":{"kind":"Name","value":"taskProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}}]}}]}}]} as unknown as DocumentNode<CreateAgentMutation, CreateAgentMutationVariables>;
export const SendMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SendMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"text"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"recipients"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RecipientInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sendMessage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"text"},"value":{"kind":"Variable","name":{"kind":"Name","value":"text"}}},{"kind":"Argument","name":{"kind":"Name","value":"recipients"},"value":{"kind":"Variable","name":{"kind":"Name","value":"recipients"}}}]}]}}]} as unknown as DocumentNode<SendMessageMutation, SendMessageMutationVariables>;
export const CreateProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateProjectMutation, CreateProjectMutationVariables>;
export const SetProjectThemeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetProjectTheme"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetProjectThemeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setProjectTheme"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<SetProjectThemeMutation, SetProjectThemeMutationVariables>;
export const SetAccountSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAccountSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetAccountSecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAccountSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SetAccountSecretMutation, SetAccountSecretMutationVariables>;
export const DeleteAccountSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAccountSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAccountSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<DeleteAccountSecretMutation, DeleteAccountSecretMutationVariables>;
export const SetSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetSecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SetSecretMutation, SetSecretMutationVariables>;
export const DeleteSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<DeleteSecretMutation, DeleteSecretMutationVariables>;
export const CreateSkillDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSkill"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSkillInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSkill"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"assignedTags"}},{"kind":"Field","name":{"kind":"Name","value":"assignedToAll"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreateSkillMutation, CreateSkillMutationVariables>;
export const UpdateSkillDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSkill"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSkillInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSkill"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"assignedTags"}},{"kind":"Field","name":{"kind":"Name","value":"assignedToAll"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateSkillMutation, UpdateSkillMutationVariables>;
export const DeleteSkillDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSkill"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"skillId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSkill"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"skillId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"skillId"}}}]}]}}]} as unknown as DocumentNode<DeleteSkillMutation, DeleteSkillMutationVariables>;
export const UpdateTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"taskId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTaskMutation, UpdateTaskMutationVariables>;
export const CreateTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"title"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"title"},"value":{"kind":"Variable","name":{"kind":"Name","value":"title"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"assignee"}},{"kind":"Field","name":{"kind":"Name","value":"activeForm"}},{"kind":"Field","name":{"kind":"Name","value":"blockedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreateTaskMutation, CreateTaskMutationVariables>;
export const CreateVncTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateVncToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createVncToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]} as unknown as DocumentNode<CreateVncTokenMutation, CreateVncTokenMutationVariables>;
export const SearchMcpRegistryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SearchMcpRegistry"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"query"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"searchMcpRegistry"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"query"},"value":{"kind":"Variable","name":{"kind":"Name","value":"query"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"servers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"websiteUrl"}},{"kind":"Field","name":{"kind":"Name","value":"hasRemote"}},{"kind":"Field","name":{"kind":"Name","value":"packages"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registryType"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"transportType"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}}]}}]}}]} as unknown as DocumentNode<SearchMcpRegistryQuery, SearchMcpRegistryQueryVariables>;
export const GetAgentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAgents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}},{"kind":"Field","name":{"kind":"Name","value":"previewState"}},{"kind":"Field","name":{"kind":"Name","value":"previewRuntimeId"}},{"kind":"Field","name":{"kind":"Name","value":"attentionLevel"}},{"kind":"Field","name":{"kind":"Name","value":"relayConnected"}},{"kind":"Field","name":{"kind":"Name","value":"mode"}},{"kind":"Field","name":{"kind":"Name","value":"task"}},{"kind":"Field","name":{"kind":"Name","value":"cost"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"turns"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"liveAction"}},{"kind":"Field","name":{"kind":"Name","value":"lastOutput"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"mcpServers"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"workspacePath"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"}},{"kind":"Field","name":{"kind":"Name","value":"computeSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"taskProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tasks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"assignee"}},{"kind":"Field","name":{"kind":"Name","value":"activeForm"}},{"kind":"Field","name":{"kind":"Name","value":"blockedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<GetAgentsQuery, GetAgentsQueryVariables>;
export const GetAgentFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAgentFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entryType"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"data"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetAgentFeedQuery, GetAgentFeedQueryVariables>;
export const GetFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"feed"},"name":{"kind":"Name","value":"teamFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"agent"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"command"}},{"kind":"Field","name":{"kind":"Name","value":"risk"}},{"kind":"Field","name":{"kind":"Name","value":"permStatus"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planStatus"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"cost"}},{"kind":"Field","name":{"kind":"Name","value":"turns"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"from"}},{"kind":"Field","name":{"kind":"Name","value":"to"}},{"kind":"Field","name":{"kind":"Name","value":"target"}},{"kind":"Field","name":{"kind":"Name","value":"question"}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"questions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"options"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isError"}}]}}]}}]} as unknown as DocumentNode<GetFeedQuery, GetFeedQueryVariables>;
export const AvailableModelsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AvailableModels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"availableModels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}}]}}]}}]} as unknown as DocumentNode<AvailableModelsQuery, AvailableModelsQueryVariables>;
export const ProviderStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProviderStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providerStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"keyName"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}}]}}]}}]} as unknown as DocumentNode<ProviderStatusQuery, ProviderStatusQueryVariables>;
export const GetProjectsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProjects"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"projects"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetProjectsQuery, GetProjectsQueryVariables>;
export const GetProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"project"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"themeDocument"}},{"kind":"Field","name":{"kind":"Name","value":"themeTokens"}}]}}]}}]} as unknown as DocumentNode<GetProjectQuery, GetProjectQueryVariables>;
export const GetAccountSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAccountSecrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountSecrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<GetAccountSecretsQuery, GetAccountSecretsQueryVariables>;
export const GetProjectSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProjectSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"projectSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<GetProjectSecretsQuery, GetProjectSecretsQueryVariables>;
export const GetSkillsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSkills"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"skills"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"assignedTags"}},{"kind":"Field","name":{"kind":"Name","value":"assignedToAll"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<GetSkillsQuery, GetSkillsQueryVariables>;
export const GetAgentTasksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAgentTasks"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tasks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"assignee"}},{"kind":"Field","name":{"kind":"Name","value":"activeForm"}},{"kind":"Field","name":{"kind":"Name","value":"blockedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<GetAgentTasksQuery, GetAgentTasksQueryVariables>;