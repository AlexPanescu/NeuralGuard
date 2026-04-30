using System.Diagnostics;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        try
        {
            var executableDir = AppContext.BaseDirectory;
            var projectRoot = ResolveProjectRoot(executableDir);
            if (projectRoot is null)
            {
                MessageBox.Show(
                    "Nu am putut identifica radacina proiectului.\n" +
                    "Asigura-te ca launcherul este in proiectul Neural Guard.",
                    "NeuralGuard Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            var startScript = Path.Combine(projectRoot, "powershell", "start-dev.ps1");
            if (!File.Exists(startScript))
            {
                MessageBox.Show(
                    $"Lipseste scriptul: {startScript}",
                    "NeuralGuard Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-ExecutionPolicy Bypass -File \"{startScript}\"",
                WorkingDirectory = projectRoot,
                UseShellExecute = true,
            };

            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Eroare la pornirea aplicatiei:\n" + ex.Message,
                "NeuralGuard Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private static string? ResolveProjectRoot(string baseDirectory)
    {
        var current = new DirectoryInfo(baseDirectory);

        while (current is not null)
        {
            var hasBackend = Directory.Exists(Path.Combine(current.FullName, "backend"));
            var hasFrontend = Directory.Exists(Path.Combine(current.FullName, "frontend"));
            var hasStartScript = File.Exists(Path.Combine(current.FullName, "powershell", "start-dev.ps1"));

            if (hasBackend && hasFrontend && hasStartScript)
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return null;
    }
}
