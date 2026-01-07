// Shortcut: control ;
// Name: Linear Planner
// Description: Launch Linear and create a new issue for your planning board.
// Author: GZMaster
// GitHub:

import "@johnlindquist/kit"

const LINEAR_API_KEY = await env("LINEAR_API_KEY", {
  placeholder: "Enter your Linear API Key",
  secret: true,
  panel: md(`Get your API key from https://linear.app/settings/developers`),
})

async function gql<T = any>(query: string, variables: any = {}): Promise<T> {
  const res = await post(
    "https://api.linear.app/graphql",
    { query, variables },
    {
      headers: {
        Authorization: LINEAR_API_KEY,
        "Content-Type": "application/json",
      },
    }
  )
  return res.data as T
}

// Try to launch the Linear desktop app, fallback to browser
try {
  await openApp("Linear")
} catch {
  await browse("https://linear.app")
}

// Fetch teams
type Team = { id: string; name: string; key: string }
const teamsRes = await gql<{ data?: { teams?: { nodes?: Team[] } }; errors?: any }>(`
  query {
    teams(first: 50) {
      nodes {
        id
        name
        key
      }
    }
  }
`)

const teams: Team[] = teamsRes?.data?.teams?.nodes || []
if (!teams.length) {
  await notify("No Linear teams found or invalid API key.")
  exit()
}

const team = await arg<Team>(
  "Select a Linear Team",
  teams.map(t => ({
    name: `${t.name} (${t.key})`,
    value: t,
  }))
)

// Gather issue details
const title = await arg("Issue title")
const description = await editor({
  value: "",
  hint: "Optional description. Leave blank and submit to skip.",
})

// Try to find a 'Planning' label for the team
const labelsRes = await gql<{
  data?: { team?: { labels?: { nodes?: { id: string; name: string }[] } } }
}>(`
  query($id: String!) {
    team(id: $id) {
      labels(first: 100) {
        nodes {
          id
          name
        }
      }
    }
  }
`, { id: team.id })

const teamLabels = labelsRes?.data?.team?.labels?.nodes || []
const planningLabel = teamLabels.find(l => /planning/i.test(l.name))
const labelIds = planningLabel ? [planningLabel.id] : undefined

// Fetch users (assignees) for selection
const usersRes = await gql<{
  data?: { users?: { nodes?: { id: string; name?: string; email?: string; displayName?: string }[] } }
  errors?: any
}>(`
  query {
    users(first: 200) {
      nodes {
        id
        name
        displayName
        email
      }
    }
  }
`)

const users = usersRes?.data?.users?.nodes || []
const assigneeChoice = await arg(
  "Assign to (optional)",
  [
    { name: "(no assignee)", value: undefined },
    ...users.map(u => ({ name: `${u.displayName || u.name || u.email || u.id}`, value: u.id })),
  ]
)
const assigneeId = assigneeChoice || undefined

// Create the issue
const createRes = await gql<{
  data?: { issueCreate?: { success: boolean; issue?: { id: string; identifier: string; url: string; title: string } } }
  errors?: any
}>(`
  mutation($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        url
        title
      }
    }
  }
`, {
  input: {
    teamId: team.id,
    title,
    description: description?.trim() || undefined,
    labelIds,
    assigneeId: assigneeId,
  },
})

const issue = createRes?.data?.issueCreate?.issue
if (!issue) {
  await notify("Failed to create issue. Check API key/permissions.")
  exit()
}

await copy(issue.url)
await notify(`Created ${issue.identifier}: ${issue.title}`)
await browse(issue.url)