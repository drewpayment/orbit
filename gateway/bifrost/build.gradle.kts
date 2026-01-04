// gateway/bifrost/build.gradle.kts
plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    application
    id("com.google.protobuf") version "0.9.4"
}

group = "io.orbit"
version = "0.1.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    // Kroxylicious
    implementation("io.kroxylicious:kroxylicious-api:0.9.0")
    implementation("io.kroxylicious:kroxylicious-runtime:0.9.0")

    // Kafka
    implementation("org.apache.kafka:kafka-clients:3.6.1")

    // gRPC
    implementation("io.grpc:grpc-kotlin-stub:1.4.1")
    implementation("io.grpc:grpc-protobuf:1.60.0")
    implementation("io.grpc:grpc-netty-shaded:1.60.0")
    implementation("com.google.protobuf:protobuf-kotlin:3.25.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // Logging
    implementation("io.github.microutils:kotlin-logging-jvm:3.0.5")
    implementation("ch.qos.logback:logback-classic:1.4.14")

    // Configuration
    implementation("com.typesafe:config:1.4.3")

    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
    testImplementation("io.mockk:mockk:1.13.8")
    testImplementation("org.testcontainers:kafka:1.19.3")
    testImplementation("org.testcontainers:junit-jupiter:1.19.3")
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:3.25.1"
    }
    plugins {
        create("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:1.60.0"
        }
        create("grpckt") {
            artifact = "io.grpc:protoc-gen-grpc-kotlin:1.4.1:jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach {
            it.plugins {
                create("grpc")
                create("grpckt")
            }
            it.builtins {
                create("kotlin")
            }
        }
    }
}

sourceSets {
    main {
        proto {
            // Include protos from the monorepo proto directory
            srcDir("../../proto")
        }
    }
}

application {
    mainClass.set("io.orbit.bifrost.ApplicationKt")
}

tasks.test {
    useJUnitPlatform()
}
