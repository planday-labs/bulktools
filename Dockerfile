# Stage 1: Build .NET app (frontend built by MSBuild targets in the csproj)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env

# Install Node.js for frontend builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY . .

ENV HUSKY=0

RUN dotnet restore
RUN dotnet publish src/InternalHostedFrontendTools.Api --output /app/ --configuration Release

# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0

ENV ASPNETCORE_URLS=http://+:5000

EXPOSE 5000

USER app

WORKDIR /app
COPY --from=build-env /app .
ENTRYPOINT ["bash", "-c", "dotnet InternalHostedFrontendTools.Api.dll"]
