require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'OttieLiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Ottie'
  s.homepage       = 'https://ottie.app'
  # ActivityKit ships from 16.1; ActivityContent/ActivityAuthorizationInfo
  # require 16.2 and are guarded with #available(iOS 16.2, *) in the module.
  # Older devices fall through to the no-op `unavailable_ios_version` error.
  s.platforms      = { :ios => '16.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
