#define MyAppName "Fixture Forge"
#define MyAppVersion GetEnv("FIXTURE_FORGE_VERSION")
#if MyAppVersion == ""
#define MyAppVersion "1.0.0"
#endif
#define MyAppExeName "FixtureForge.exe"

[Setup]
AppId={{3E9230F1-8360-41E7-82BD-0B36A265E4E6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Fixture Forge
DefaultDirName={autopf}\Fixture Forge
DefaultGroupName=Fixture Forge
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=FixtureForge-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "..\dist\FixtureForge.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Fixture Forge"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Fixture Forge"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,Fixture Forge}"; Flags: nowait postinstall skipifsilent
