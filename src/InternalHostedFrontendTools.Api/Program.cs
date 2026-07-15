var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.UseDefaultFiles(); // / → wwwroot/index.html, /pdbulkupload/ → wwwroot/pdbulkupload/index.html
app.UseStaticFiles();

app.MapGet("/ready", () => Results.Ok("ready"));
app.MapGet("/startup", () => Results.Ok("ready"));

await app.RunAsync();
