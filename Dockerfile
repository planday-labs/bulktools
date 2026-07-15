# Stage 1: Build .NET app (frontend built by MSBuild targets in the csproj)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env

ARG SONARQUBE_URL
ARG APPLICATION_NAME
ARG SONARQUBE_PROJECT_NAME
ARG SONARQUBE_TOKEN
ARG SONARQUBE_VERSION

# Install Java (SonarQube) and Node.js in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN dotnet tool install --global dotnet-sonarscanner
ENV PATH=$PATH:/root/.dotnet/tools

WORKDIR /build

COPY . .

ENV HUSKY=0

RUN dotnet restore

RUN dotnet sonarscanner begin /k:"${SONARQUBE_PROJECT_NAME}" /d:sonar.host.url="${SONARQUBE_URL}" /d:sonar.login="${SONARQUBE_TOKEN}" /d:sonar.cs.cobertura.reportsPaths="./tests/*/bin/Release/*/TestResults/*.cobertura.xml" /v:"${SONARQUBE_VERSION}" /d:sonar.scanner.scanAll=false
RUN dotnet test --no-restore --configuration Release -- --coverage --coverage-output-format cobertura
RUN dotnet build --no-restore --configuration Release
RUN dotnet sonarscanner end /d:sonar.login="${SONARQUBE_TOKEN}"

RUN dotnet publish src/InternalHostedFrontendTools.Api --output /app/ --configuration Release

# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0

ENV ASPNETCORE_URLS=http://+:5000

EXPOSE 5000

USER app

WORKDIR /app
COPY --from=build-env /app .
ENTRYPOINT ["bash", "-c", "dotnet InternalHostedFrontendTools.Api.dll"]
