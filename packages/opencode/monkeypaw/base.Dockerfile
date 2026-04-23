# syntax=docker/dockerfile:1.7

FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-lc"]
