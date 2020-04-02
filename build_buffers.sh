#!/bin/bash
set -x

pushd shared/protos/
flatc --ts messages.fbs --no-fb-import
popd
