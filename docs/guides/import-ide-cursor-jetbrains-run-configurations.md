# Import VS Code, Cursor, and JetBrains Run Configurations

[Back to the README](../../README.md) · [Using Avenil](../USAGE.md)

Avenil can preview supported IDE run configurations and turn them into local development services. This is useful when a project already describes how to start its frontend, API, worker, or test process in VS Code, Cursor, or JetBrains.

Import is preview-first: Avenil shows what it can translate, redacts environment values in the preview, and only adds the selected entries after you confirm them.

## Start an import

1. Open the project root in Avenil.
2. Choose **Import from IDE** (`从 IDE 导入` in the current preview interface).
3. Select the project root that contains the configuration files.
4. Review the detected entries and any warnings.
5. Select entries marked as ready.
6. Confirm the import to add a new project group and its services.

Import does not execute commands, overwrite existing services, or silently convert unsupported settings.

## Supported configuration files

Avenil looks for:

- `.vscode/launch.json`, including Cursor projects that use the same format.
- `.idea/runConfigurations/*.xml`.
- `.run/*.xml`.

Each configuration file is limited to 2 MiB. The preview classifies candidates as `ready`, `needsInput`, or `unsupported`.

## Supported starting points

| IDE configuration | What Avenil needs |
| --- | --- |
| VS Code / Cursor `node-terminal` | An explicit runnable command and working directory. |
| VS Code / Cursor `node` or `pwa-node` | An entry point and determinable runtime settings, or an `npm run` script. |
| VS Code Java Spring Boot | `mainClass` and a Maven project declaring `spring-boot-maven-plugin`. |
| Python launch | An explicit interpreter and entry point. |
| JetBrains Maven / Gradle | Explicit goals or tasks and a working directory. |

Java Spring Boot entries are imported as `mvn spring-boot:run`. A Java entry without a detectable Spring Boot Maven project may require manual input because the classpath, module path, JRE, or build command cannot be inferred safely.

## What is not silently converted

The following configurations may be marked unsupported or require input:

- Compound launches and attached configurations.
- Task dependencies.
- `envFile` and dynamic variables.
- Unknown extensions.
- Java configurations without enough project information.
- Non-empty Java arguments whose boundaries cannot be determined safely.

Environment values are redacted in the preview and preserved in the imported local configuration. The interface masks values marked as secret, but local configuration values are not encrypted at rest.

## After importing

Review the generated working directories and commands before starting the services. Imported entries become ordinary Avenil services, so you can edit their names, ports, URLs, and environment settings within the normal service workflow.

For the broader local service workflow, see [Manage local development services on macOS](manage-local-development-services-on-macos.md).
