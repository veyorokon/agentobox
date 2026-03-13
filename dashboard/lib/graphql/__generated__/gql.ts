/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  mutation SetAgentMode($agentId: ID!, $mode: String!) {\n    setAgentMode(agentId: $agentId, mode: $mode) {\n      id\n      mode\n    }\n  }\n": typeof types.SetAgentModeDocument,
    "\n  mutation ResolvePermission($feedItemId: ID!, $verdict: String!, $alwaysAllow: Boolean) {\n    resolvePermission(feedItemId: $feedItemId, verdict: $verdict, alwaysAllow: $alwaysAllow) {\n      id\n      permStatus\n    }\n  }\n": typeof types.ResolvePermissionDocument,
    "\n  mutation ResolvePlan($feedItemId: ID!, $verdict: String!) {\n    resolvePlan(feedItemId: $feedItemId, verdict: $verdict) {\n      id\n      planStatus\n    }\n  }\n": typeof types.ResolvePlanDocument,
    "\n  mutation KillAgent($agentId: ID!) {\n    killAgent(agentId: $agentId)\n  }\n": typeof types.KillAgentDocument,
    "\n  mutation RemoveAgent($agentId: ID!) {\n    removeAgent(agentId: $agentId)\n  }\n": typeof types.RemoveAgentDocument,
    "\n  mutation HardRestartAgent($agentId: ID!) {\n    hardRestartAgent(agentId: $agentId) {\n      id\n      lifecycleStatus\n    }\n  }\n": typeof types.HardRestartAgentDocument,
    "\n  mutation RestartAgent($agentId: ID!) {\n    restartAgent(agentId: $agentId)\n  }\n": typeof types.RestartAgentDocument,
    "\n  mutation InterruptAgent($agentId: ID!) {\n    interruptAgent(agentId: $agentId)\n  }\n": typeof types.InterruptAgentDocument,
    "\n  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {\n    updateAgentInstructions(input: $input) {\n      id\n      instructions\n    }\n  }\n": typeof types.UpdateAgentInstructionsDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      id\n      model\n      role\n      tags\n      mcpServers\n    }\n  }\n": typeof types.UpdateAgentConfigDocument,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      taskProgress {\n        done\n        total\n      }\n    }\n  }\n": typeof types.CreateAgentDocument,
    "\n  mutation SendMessage($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {\n    sendMessage(projectId: $projectId, text: $text, recipients: $recipients)\n  }\n": typeof types.SendMessageDocument,
    "\n  mutation CreateProject($input: CreateProjectInput!) {\n    createProject(input: $input) {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n": typeof types.CreateProjectDocument,
    "\n  mutation SetProjectTheme($input: SetProjectThemeInput!) {\n    setProjectTheme(input: $input)\n  }\n": typeof types.SetProjectThemeDocument,
    "\n  mutation SetAccountSecret($input: SetAccountSecretInput!) {\n    setAccountSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SetAccountSecretDocument,
    "\n  mutation DeleteAccountSecret($key: String!) {\n    deleteAccountSecret(key: $key)\n  }\n": typeof types.DeleteAccountSecretDocument,
    "\n  mutation SetSecret($input: SetSecretInput!) {\n    setSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SetSecretDocument,
    "\n  mutation DeleteSecret($projectId: ID!, $key: String!) {\n    deleteSecret(projectId: $projectId, key: $key)\n  }\n": typeof types.DeleteSecretDocument,
    "\n  mutation CreateSkill($input: CreateSkillInput!) {\n    createSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CreateSkillDocument,
    "\n  mutation UpdateSkill($input: UpdateSkillInput!) {\n    updateSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.UpdateSkillDocument,
    "\n  mutation DeleteSkill($skillId: ID!) {\n    deleteSkill(skillId: $skillId)\n  }\n": typeof types.DeleteSkillDocument,
    "\n  mutation UpdateTask($agentId: ID!, $taskId: String!, $status: String!) {\n    updateTask(agentId: $agentId, taskId: $taskId, status: $status) {\n      taskId\n      status\n      updatedAt\n    }\n  }\n": typeof types.UpdateTaskDocument,
    "\n  mutation CreateTask($agentId: ID!, $title: String!, $description: String!) {\n    createTask(agentId: $agentId, title: $title, description: $description) {\n      taskId\n      title\n      description\n      status\n      assignee\n      activeForm\n      blockedBy\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CreateTaskDocument,
    "\n  mutation CreateVncToken($agentId: ID!) {\n    createVncToken(agentId: $agentId) {\n      token\n      expiresAt\n    }\n  }\n": typeof types.CreateVncTokenDocument,
    "\n  query SearchMcpRegistry($query: String, $limit: Int, $cursor: String) {\n    searchMcpRegistry(query: $query, limit: $limit, cursor: $cursor) {\n      servers {\n        name\n        description\n        version\n        websiteUrl\n        hasRemote\n        packages {\n          registryType\n          identifier\n          transportType\n        }\n      }\n      nextCursor\n    }\n  }\n": typeof types.SearchMcpRegistryDocument,
    "\n  query GetAgents($projectId: ID!) {\n    agents(projectId: $projectId) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      relayConnected\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      errorMessage\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      triggers\n      computeSeconds\n      taskProgress {\n        done\n        total\n      }\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.GetAgentsDocument,
    "\n  query GetAgentFeed($agentId: ID!, $first: Int, $after: String) {\n    agentFeed(agentId: $agentId, first: $first, after: $after) {\n      id\n      entryType\n      agentId\n      agentName\n      summary\n      data\n      createdAt\n    }\n  }\n": typeof types.GetAgentFeedDocument,
    "\n  query GetFeed($projectId: ID!) {\n    feed: teamFeed(projectId: $projectId) {\n      id\n      type\n      agent\n      agentId\n      text\n      command\n      risk\n      permStatus\n      title\n      plan\n      planStatus\n      summary\n      cost\n      turns\n      duration\n      from\n      to\n      target\n      question\n      options\n      questions {\n        text\n        options\n      }\n      isError\n    }\n  }\n": typeof types.GetFeedDocument,
    "\n  query AvailableModels {\n    availableModels {\n      value\n      label\n      provider\n    }\n  }\n": typeof types.AvailableModelsDocument,
    "\n  query ProviderStatus($projectId: ID!) {\n    providerStatus(projectId: $projectId) {\n      slug\n      name\n      keyName\n      configured\n    }\n  }\n": typeof types.ProviderStatusDocument,
    "\n  query GetProjects {\n    projects {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n": typeof types.GetProjectsDocument,
    "\n  query GetProject($id: ID!) {\n    project(id: $id) {\n      id\n      name\n      description\n    }\n  }\n": typeof types.GetProjectDocument,
    "\n  query GetAccountSecrets {\n    accountSecrets {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.GetAccountSecretsDocument,
    "\n  query GetProjectSecrets($projectId: ID!) {\n    projectSecrets(projectId: $projectId) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.GetProjectSecretsDocument,
    "\n  query GetSkills($projectId: ID!) {\n    skills(projectId: $projectId) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.GetSkillsDocument,
    "\n  query GetAgentTasks($agentId: ID!) {\n    agent(agentId: $agentId) {\n      id\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.GetAgentTasksDocument,
};
const documents: Documents = {
    "\n  mutation SetAgentMode($agentId: ID!, $mode: String!) {\n    setAgentMode(agentId: $agentId, mode: $mode) {\n      id\n      mode\n    }\n  }\n": types.SetAgentModeDocument,
    "\n  mutation ResolvePermission($feedItemId: ID!, $verdict: String!, $alwaysAllow: Boolean) {\n    resolvePermission(feedItemId: $feedItemId, verdict: $verdict, alwaysAllow: $alwaysAllow) {\n      id\n      permStatus\n    }\n  }\n": types.ResolvePermissionDocument,
    "\n  mutation ResolvePlan($feedItemId: ID!, $verdict: String!) {\n    resolvePlan(feedItemId: $feedItemId, verdict: $verdict) {\n      id\n      planStatus\n    }\n  }\n": types.ResolvePlanDocument,
    "\n  mutation KillAgent($agentId: ID!) {\n    killAgent(agentId: $agentId)\n  }\n": types.KillAgentDocument,
    "\n  mutation RemoveAgent($agentId: ID!) {\n    removeAgent(agentId: $agentId)\n  }\n": types.RemoveAgentDocument,
    "\n  mutation HardRestartAgent($agentId: ID!) {\n    hardRestartAgent(agentId: $agentId) {\n      id\n      lifecycleStatus\n    }\n  }\n": types.HardRestartAgentDocument,
    "\n  mutation RestartAgent($agentId: ID!) {\n    restartAgent(agentId: $agentId)\n  }\n": types.RestartAgentDocument,
    "\n  mutation InterruptAgent($agentId: ID!) {\n    interruptAgent(agentId: $agentId)\n  }\n": types.InterruptAgentDocument,
    "\n  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {\n    updateAgentInstructions(input: $input) {\n      id\n      instructions\n    }\n  }\n": types.UpdateAgentInstructionsDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      id\n      model\n      role\n      tags\n      mcpServers\n    }\n  }\n": types.UpdateAgentConfigDocument,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      taskProgress {\n        done\n        total\n      }\n    }\n  }\n": types.CreateAgentDocument,
    "\n  mutation SendMessage($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {\n    sendMessage(projectId: $projectId, text: $text, recipients: $recipients)\n  }\n": types.SendMessageDocument,
    "\n  mutation CreateProject($input: CreateProjectInput!) {\n    createProject(input: $input) {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n": types.CreateProjectDocument,
    "\n  mutation SetProjectTheme($input: SetProjectThemeInput!) {\n    setProjectTheme(input: $input)\n  }\n": types.SetProjectThemeDocument,
    "\n  mutation SetAccountSecret($input: SetAccountSecretInput!) {\n    setAccountSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": types.SetAccountSecretDocument,
    "\n  mutation DeleteAccountSecret($key: String!) {\n    deleteAccountSecret(key: $key)\n  }\n": types.DeleteAccountSecretDocument,
    "\n  mutation SetSecret($input: SetSecretInput!) {\n    setSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": types.SetSecretDocument,
    "\n  mutation DeleteSecret($projectId: ID!, $key: String!) {\n    deleteSecret(projectId: $projectId, key: $key)\n  }\n": types.DeleteSecretDocument,
    "\n  mutation CreateSkill($input: CreateSkillInput!) {\n    createSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": types.CreateSkillDocument,
    "\n  mutation UpdateSkill($input: UpdateSkillInput!) {\n    updateSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": types.UpdateSkillDocument,
    "\n  mutation DeleteSkill($skillId: ID!) {\n    deleteSkill(skillId: $skillId)\n  }\n": types.DeleteSkillDocument,
    "\n  mutation UpdateTask($agentId: ID!, $taskId: String!, $status: String!) {\n    updateTask(agentId: $agentId, taskId: $taskId, status: $status) {\n      taskId\n      status\n      updatedAt\n    }\n  }\n": types.UpdateTaskDocument,
    "\n  mutation CreateTask($agentId: ID!, $title: String!, $description: String!) {\n    createTask(agentId: $agentId, title: $title, description: $description) {\n      taskId\n      title\n      description\n      status\n      assignee\n      activeForm\n      blockedBy\n      createdAt\n      updatedAt\n    }\n  }\n": types.CreateTaskDocument,
    "\n  mutation CreateVncToken($agentId: ID!) {\n    createVncToken(agentId: $agentId) {\n      token\n      expiresAt\n    }\n  }\n": types.CreateVncTokenDocument,
    "\n  query SearchMcpRegistry($query: String, $limit: Int, $cursor: String) {\n    searchMcpRegistry(query: $query, limit: $limit, cursor: $cursor) {\n      servers {\n        name\n        description\n        version\n        websiteUrl\n        hasRemote\n        packages {\n          registryType\n          identifier\n          transportType\n        }\n      }\n      nextCursor\n    }\n  }\n": types.SearchMcpRegistryDocument,
    "\n  query GetAgents($projectId: ID!) {\n    agents(projectId: $projectId) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      relayConnected\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      errorMessage\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      triggers\n      computeSeconds\n      taskProgress {\n        done\n        total\n      }\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.GetAgentsDocument,
    "\n  query GetAgentFeed($agentId: ID!, $first: Int, $after: String) {\n    agentFeed(agentId: $agentId, first: $first, after: $after) {\n      id\n      entryType\n      agentId\n      agentName\n      summary\n      data\n      createdAt\n    }\n  }\n": types.GetAgentFeedDocument,
    "\n  query GetFeed($projectId: ID!) {\n    feed: teamFeed(projectId: $projectId) {\n      id\n      type\n      agent\n      agentId\n      text\n      command\n      risk\n      permStatus\n      title\n      plan\n      planStatus\n      summary\n      cost\n      turns\n      duration\n      from\n      to\n      target\n      question\n      options\n      questions {\n        text\n        options\n      }\n      isError\n    }\n  }\n": types.GetFeedDocument,
    "\n  query AvailableModels {\n    availableModels {\n      value\n      label\n      provider\n    }\n  }\n": types.AvailableModelsDocument,
    "\n  query ProviderStatus($projectId: ID!) {\n    providerStatus(projectId: $projectId) {\n      slug\n      name\n      keyName\n      configured\n    }\n  }\n": types.ProviderStatusDocument,
    "\n  query GetProjects {\n    projects {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n": types.GetProjectsDocument,
    "\n  query GetProject($id: ID!) {\n    project(id: $id) {\n      id\n      name\n      description\n    }\n  }\n": types.GetProjectDocument,
    "\n  query GetAccountSecrets {\n    accountSecrets {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": types.GetAccountSecretsDocument,
    "\n  query GetProjectSecrets($projectId: ID!) {\n    projectSecrets(projectId: $projectId) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n": types.GetProjectSecretsDocument,
    "\n  query GetSkills($projectId: ID!) {\n    skills(projectId: $projectId) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n": types.GetSkillsDocument,
    "\n  query GetAgentTasks($agentId: ID!) {\n    agent(agentId: $agentId) {\n      id\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.GetAgentTasksDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetAgentMode($agentId: ID!, $mode: String!) {\n    setAgentMode(agentId: $agentId, mode: $mode) {\n      id\n      mode\n    }\n  }\n"): (typeof documents)["\n  mutation SetAgentMode($agentId: ID!, $mode: String!) {\n    setAgentMode(agentId: $agentId, mode: $mode) {\n      id\n      mode\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResolvePermission($feedItemId: ID!, $verdict: String!, $alwaysAllow: Boolean) {\n    resolvePermission(feedItemId: $feedItemId, verdict: $verdict, alwaysAllow: $alwaysAllow) {\n      id\n      permStatus\n    }\n  }\n"): (typeof documents)["\n  mutation ResolvePermission($feedItemId: ID!, $verdict: String!, $alwaysAllow: Boolean) {\n    resolvePermission(feedItemId: $feedItemId, verdict: $verdict, alwaysAllow: $alwaysAllow) {\n      id\n      permStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResolvePlan($feedItemId: ID!, $verdict: String!) {\n    resolvePlan(feedItemId: $feedItemId, verdict: $verdict) {\n      id\n      planStatus\n    }\n  }\n"): (typeof documents)["\n  mutation ResolvePlan($feedItemId: ID!, $verdict: String!) {\n    resolvePlan(feedItemId: $feedItemId, verdict: $verdict) {\n      id\n      planStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation KillAgent($agentId: ID!) {\n    killAgent(agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation KillAgent($agentId: ID!) {\n    killAgent(agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveAgent($agentId: ID!) {\n    removeAgent(agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation RemoveAgent($agentId: ID!) {\n    removeAgent(agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation HardRestartAgent($agentId: ID!) {\n    hardRestartAgent(agentId: $agentId) {\n      id\n      lifecycleStatus\n    }\n  }\n"): (typeof documents)["\n  mutation HardRestartAgent($agentId: ID!) {\n    hardRestartAgent(agentId: $agentId) {\n      id\n      lifecycleStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RestartAgent($agentId: ID!) {\n    restartAgent(agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation RestartAgent($agentId: ID!) {\n    restartAgent(agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InterruptAgent($agentId: ID!) {\n    interruptAgent(agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation InterruptAgent($agentId: ID!) {\n    interruptAgent(agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {\n    updateAgentInstructions(input: $input) {\n      id\n      instructions\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {\n    updateAgentInstructions(input: $input) {\n      id\n      instructions\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      id\n      model\n      role\n      tags\n      mcpServers\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      id\n      model\n      role\n      tags\n      mcpServers\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      taskProgress {\n        done\n        total\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      taskProgress {\n        done\n        total\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SendMessage($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {\n    sendMessage(projectId: $projectId, text: $text, recipients: $recipients)\n  }\n"): (typeof documents)["\n  mutation SendMessage($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {\n    sendMessage(projectId: $projectId, text: $text, recipients: $recipients)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateProject($input: CreateProjectInput!) {\n    createProject(input: $input) {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CreateProject($input: CreateProjectInput!) {\n    createProject(input: $input) {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetProjectTheme($input: SetProjectThemeInput!) {\n    setProjectTheme(input: $input)\n  }\n"): (typeof documents)["\n  mutation SetProjectTheme($input: SetProjectThemeInput!) {\n    setProjectTheme(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetAccountSecret($input: SetAccountSecretInput!) {\n    setAccountSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SetAccountSecret($input: SetAccountSecretInput!) {\n    setAccountSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAccountSecret($key: String!) {\n    deleteAccountSecret(key: $key)\n  }\n"): (typeof documents)["\n  mutation DeleteAccountSecret($key: String!) {\n    deleteAccountSecret(key: $key)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetSecret($input: SetSecretInput!) {\n    setSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SetSecret($input: SetSecretInput!) {\n    setSecret(input: $input) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSecret($projectId: ID!, $key: String!) {\n    deleteSecret(projectId: $projectId, key: $key)\n  }\n"): (typeof documents)["\n  mutation DeleteSecret($projectId: ID!, $key: String!) {\n    deleteSecret(projectId: $projectId, key: $key)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSkill($input: CreateSkillInput!) {\n    createSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CreateSkill($input: CreateSkillInput!) {\n    createSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateSkill($input: UpdateSkillInput!) {\n    updateSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateSkill($input: UpdateSkillInput!) {\n    updateSkill(input: $input) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSkill($skillId: ID!) {\n    deleteSkill(skillId: $skillId)\n  }\n"): (typeof documents)["\n  mutation DeleteSkill($skillId: ID!) {\n    deleteSkill(skillId: $skillId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateTask($agentId: ID!, $taskId: String!, $status: String!) {\n    updateTask(agentId: $agentId, taskId: $taskId, status: $status) {\n      taskId\n      status\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateTask($agentId: ID!, $taskId: String!, $status: String!) {\n    updateTask(agentId: $agentId, taskId: $taskId, status: $status) {\n      taskId\n      status\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTask($agentId: ID!, $title: String!, $description: String!) {\n    createTask(agentId: $agentId, title: $title, description: $description) {\n      taskId\n      title\n      description\n      status\n      assignee\n      activeForm\n      blockedBy\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CreateTask($agentId: ID!, $title: String!, $description: String!) {\n    createTask(agentId: $agentId, title: $title, description: $description) {\n      taskId\n      title\n      description\n      status\n      assignee\n      activeForm\n      blockedBy\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateVncToken($agentId: ID!) {\n    createVncToken(agentId: $agentId) {\n      token\n      expiresAt\n    }\n  }\n"): (typeof documents)["\n  mutation CreateVncToken($agentId: ID!) {\n    createVncToken(agentId: $agentId) {\n      token\n      expiresAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchMcpRegistry($query: String, $limit: Int, $cursor: String) {\n    searchMcpRegistry(query: $query, limit: $limit, cursor: $cursor) {\n      servers {\n        name\n        description\n        version\n        websiteUrl\n        hasRemote\n        packages {\n          registryType\n          identifier\n          transportType\n        }\n      }\n      nextCursor\n    }\n  }\n"): (typeof documents)["\n  query SearchMcpRegistry($query: String, $limit: Int, $cursor: String) {\n    searchMcpRegistry(query: $query, limit: $limit, cursor: $cursor) {\n      servers {\n        name\n        description\n        version\n        websiteUrl\n        hasRemote\n        packages {\n          registryType\n          identifier\n          transportType\n        }\n      }\n      nextCursor\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetAgents($projectId: ID!) {\n    agents(projectId: $projectId) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      relayConnected\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      errorMessage\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      triggers\n      computeSeconds\n      taskProgress {\n        done\n        total\n      }\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetAgents($projectId: ID!) {\n    agents(projectId: $projectId) {\n      id\n      name\n      lifecycleStatus\n      attentionLevel\n      relayConnected\n      mode\n      task\n      cost\n      duration\n      model\n      turns\n      phase\n      liveAction\n      lastOutput\n      errorMessage\n      tags\n      instructions\n      mcpServers\n      runtime\n      workspacePath\n      triggers\n      computeSeconds\n      taskProgress {\n        done\n        total\n      }\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetAgentFeed($agentId: ID!, $first: Int, $after: String) {\n    agentFeed(agentId: $agentId, first: $first, after: $after) {\n      id\n      entryType\n      agentId\n      agentName\n      summary\n      data\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query GetAgentFeed($agentId: ID!, $first: Int, $after: String) {\n    agentFeed(agentId: $agentId, first: $first, after: $after) {\n      id\n      entryType\n      agentId\n      agentName\n      summary\n      data\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetFeed($projectId: ID!) {\n    feed: teamFeed(projectId: $projectId) {\n      id\n      type\n      agent\n      agentId\n      text\n      command\n      risk\n      permStatus\n      title\n      plan\n      planStatus\n      summary\n      cost\n      turns\n      duration\n      from\n      to\n      target\n      question\n      options\n      questions {\n        text\n        options\n      }\n      isError\n    }\n  }\n"): (typeof documents)["\n  query GetFeed($projectId: ID!) {\n    feed: teamFeed(projectId: $projectId) {\n      id\n      type\n      agent\n      agentId\n      text\n      command\n      risk\n      permStatus\n      title\n      plan\n      planStatus\n      summary\n      cost\n      turns\n      duration\n      from\n      to\n      target\n      question\n      options\n      questions {\n        text\n        options\n      }\n      isError\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AvailableModels {\n    availableModels {\n      value\n      label\n      provider\n    }\n  }\n"): (typeof documents)["\n  query AvailableModels {\n    availableModels {\n      value\n      label\n      provider\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ProviderStatus($projectId: ID!) {\n    providerStatus(projectId: $projectId) {\n      slug\n      name\n      keyName\n      configured\n    }\n  }\n"): (typeof documents)["\n  query ProviderStatus($projectId: ID!) {\n    providerStatus(projectId: $projectId) {\n      slug\n      name\n      keyName\n      configured\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetProjects {\n    projects {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query GetProjects {\n    projects {\n      id\n      name\n      description\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetProject($id: ID!) {\n    project(id: $id) {\n      id\n      name\n      description\n    }\n  }\n"): (typeof documents)["\n  query GetProject($id: ID!) {\n    project(id: $id) {\n      id\n      name\n      description\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetAccountSecrets {\n    accountSecrets {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query GetAccountSecrets {\n    accountSecrets {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetProjectSecrets($projectId: ID!) {\n    projectSecrets(projectId: $projectId) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query GetProjectSecrets($projectId: ID!) {\n    projectSecrets(projectId: $projectId) {\n      id\n      key\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetSkills($projectId: ID!) {\n    skills(projectId: $projectId) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query GetSkills($projectId: ID!) {\n    skills(projectId: $projectId) {\n      id\n      name\n      description\n      content\n      assignedTags\n      assignedToAll\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetAgentTasks($agentId: ID!) {\n    agent(agentId: $agentId) {\n      id\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetAgentTasks($agentId: ID!) {\n    agent(agentId: $agentId) {\n      id\n      tasks {\n        taskId\n        title\n        description\n        status\n        assignee\n        activeForm\n        blockedBy\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;