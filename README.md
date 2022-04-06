# api-mecs
 
![MYX Labs](https://user-images.githubusercontent.com/9079480/160491725-e53a5334-0eb6-4e5c-9186-6e4536efbc7a.png)

This repository hosts the source code for the Membership Eligibility Criteria System's web API.

## Requirements
- Node.js v16+
- PNPM package manager `npm i -g pnpm`
- Google Cloud API authentication credentials (in JSON string format)
- Roblox account .ROBLOSECURITY cookie (recommended to create a new dedicated account for security)
- Discord webhook URL (for successful request logging)

## Setup

- Obtain the required credentials mentioned in the requirements
- Create an `.env` file and configure based on `.env.example`
- Configure the Roblox group and roleset IDs in `src/config.ts`
- Install dependencies with `pnpm i`
- Build with `pnpm build`
- Start with `node dist/index.js`

## Licence

MIT Licence.
