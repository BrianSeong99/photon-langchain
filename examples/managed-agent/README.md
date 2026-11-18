# Managed Deep Agents example

Make a copy of this directory for your deployment. In the adapter repository root, run `npm ci` and `npm pack`. From the copied example directory, unpack and install the package as a local directory dependency for the Managed Deep Agents build.

```sh
mkdir -p vendor/photon-langchain
tar -xzf /absolute/path/to/brianseong99-photon-langchain-0.1.0.tgz \
  -C vendor/photon-langchain --strip-components 1
npm install ./vendor/photon-langchain
cp .env.example .env
npm run build
```

Use [Connect a Managed Deep Agent to iMessage](../../docs/photon-imessage.md) to set the project secrets, deploy, and register the webhook. For a second model provider, set `EXAMPLE_MODEL` and that provider's credential, then redeploy with the same channel declaration.
