# gateway/bifrost/Dockerfile
FROM gradle:8.5-jdk21 AS builder

WORKDIR /app

# Copy proto files first (from monorepo root context)
COPY proto ./proto

# Copy Bifrost project files
COPY gateway/bifrost/build.gradle.kts gateway/bifrost/settings.gradle.kts gateway/bifrost/gradle.properties ./
COPY gateway/bifrost/src ./src

RUN gradle build --no-daemon -x test

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

ENV BIFROST_ADMIN_PORT=50060

EXPOSE 9092 50060

ENTRYPOINT ["java", "-jar", "app.jar"]
